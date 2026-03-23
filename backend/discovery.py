"""
Netzwerk-Scanner für go-e Wallboxen und Sungrow Wechselrichter.
Scannt das lokale /24-Subnetz parallel mit kurzen Timeouts.
"""

import asyncio
import ipaddress
import logging
import socket
from dataclasses import dataclass, field
from typing import Optional

import aiohttp
from pymodbus.client import AsyncModbusTcpClient

log = logging.getLogger(__name__)


@dataclass
class DiscoveredDevice:
    ip: str
    type: str        # "goe" | "sungrow"
    name: str
    details: dict = field(default_factory=dict)


def _local_subnets() -> list[str]:
    """
    Ermittle alle lokalen /24-Subnetze über alle Netzwerkinterfaces
    und gib alle Host-IPs zurück (dedupliziert).
    Bevorzugt private Adressen (192.168.x, 10.x, 172.16-31.x).
    """
    ips: set[str] = set()
    try:
        # Alle lokalen IPs über getaddrinfo
        hostname = socket.gethostname()
        for info in socket.getaddrinfo(hostname, None, socket.AF_INET):
            ip = info[4][0]
            addr = ipaddress.IPv4Address(ip)
            if addr.is_private and not addr.is_loopback:
                net = ipaddress.IPv4Network(f"{ip}/24", strict=False)
                for h in net.hosts():
                    ips.add(str(h))
    except Exception:
        pass

    # Fallback: default-Route Interface
    if not ips:
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("8.8.8.8", 80))
            local_ip = s.getsockname()[0]
            s.close()
            net = ipaddress.IPv4Network(f"{local_ip}/24", strict=False)
            for h in net.hosts():
                ips.add(str(h))
        except Exception:
            pass

    return list(ips)


def _local_subnet() -> list[str]:
    return _local_subnets()


async def _check_goe(session: aiohttp.ClientSession, ip: str) -> Optional[DiscoveredDevice]:
    """Prüfe ob unter dieser IP eine go-e Wallbox erreichbar ist."""
    try:
        async with session.get(f"http://{ip}/api/status", timeout=aiohttp.ClientTimeout(total=1.5)) as resp:
            if resp.status != 200:
                return None
            data = await resp.json(content_type=None)
            # go-e API v2 hat immer 'car' und 'amp' Felder
            if "car" not in data or "amp" not in data:
                return None
            serial = data.get("sse", "")
            model = data.get("typ", "")
            return DiscoveredDevice(
                ip=ip,
                type="goe",
                name=f"go-e Wallbox ({serial or ip})",
                details={
                    "serial": serial,
                    "model": model,
                    "amp": data.get("amp"),
                    "car": data.get("car"),
                },
            )
    except Exception:
        return None


async def _check_sungrow(ip: str) -> Optional[DiscoveredDevice]:
    """Prüfe ob unter dieser IP ein Sungrow Wechselrichter per Modbus TCP erreichbar ist."""
    client = AsyncModbusTcpClient(host=ip, port=502, timeout=1)
    try:
        connected = await asyncio.wait_for(client.connect(), timeout=1.5)
        if not connected:
            return None

        # Versuche Register 5016 zu lesen (PV-Leistung, bei beiden Serien vorhanden)
        result = await asyncio.wait_for(
            client.read_holding_registers(address=5015, count=2, slave=1),
            timeout=1.5
        )
        if result.isError():
            return None

        pv_w = (result.registers[0] << 16) | result.registers[1]

        # Versuche SH-spezifisches Register (13009 = Netzleistung)
        is_hybrid = False
        try:
            r2 = await asyncio.wait_for(
                client.read_holding_registers(address=13008, count=2, slave=1),
                timeout=1.0
            )
            is_hybrid = not r2.isError()
        except Exception:
            pass

        return DiscoveredDevice(
            ip=ip,
            type="sungrow",
            name=f"Sungrow {'SH Hybrid' if is_hybrid else 'SG String'} ({ip})",
            details={
                "model_series": "SH" if is_hybrid else "SG",
                "pv_w_current": pv_w,
                "slave_id": 1,
                "port": 502,
            },
        )
    except Exception:
        return None
    finally:
        client.close()


async def scan_network(progress_cb=None) -> list[DiscoveredDevice]:
    """
    Scannt das lokale /24-Netz nach go-e und Sungrow Geräten.
    Gibt eine Liste gefundener Geräte zurück.
    """
    ips = _local_subnet()
    if not ips:
        log.warning("Konnte lokales Subnetz nicht ermitteln")
        return []

    log.info("Scanne %d IPs im Subnetz...", len(ips))
    found: list[DiscoveredDevice] = []

    # go-e: HTTP-Scan mit shared session, viele parallele Verbindungen
    timeout = aiohttp.ClientTimeout(total=1.5, connect=1.0)
    connector = aiohttp.TCPConnector(limit=50, force_close=True)
    async with aiohttp.ClientSession(timeout=timeout, connector=connector) as session:
        goe_tasks = [_check_goe(session, ip) for ip in ips]
        results = await asyncio.gather(*goe_tasks, return_exceptions=True)
        for r in results:
            if isinstance(r, DiscoveredDevice):
                found.append(r)

    if progress_cb:
        progress_cb("go-e Scan abgeschlossen")

    # Sungrow: Modbus TCP Scan, max 30 gleichzeitig (Ports sind limitierend)
    sem = asyncio.Semaphore(30)

    async def _throttled(ip: str):
        async with sem:
            return await _check_sungrow(ip)

    sg_tasks = [_throttled(ip) for ip in ips]
    results = await asyncio.gather(*sg_tasks, return_exceptions=True)
    for r in results:
        if isinstance(r, DiscoveredDevice):
            found.append(r)

    log.info("Scan abgeschlossen: %d Geräte gefunden", len(found))
    return found
