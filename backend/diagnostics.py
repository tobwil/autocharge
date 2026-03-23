"""
Verbindungstest und Register-Diagnose für Sungrow und go-e.
"""

import asyncio
import socket
from typing import Any

import aiohttp
from pymodbus.client import AsyncModbusTcpClient


async def test_tcp_port(host: str, port: int, timeout: float = 2.0) -> dict:
    """Prüft ob ein TCP-Port überhaupt erreichbar ist."""
    try:
        _, writer = await asyncio.wait_for(
            asyncio.open_connection(host, port), timeout=timeout
        )
        writer.close()
        await writer.wait_closed()
        return {"reachable": True, "error": None}
    except asyncio.TimeoutError:
        return {"reachable": False, "error": f"Timeout ({timeout}s) – Gerät nicht erreichbar oder Firewall"}
    except ConnectionRefusedError:
        return {"reachable": False, "error": f"Port {port} abgelehnt – Modbus TCP evtl. nicht aktiviert"}
    except OSError as e:
        return {"reachable": False, "error": str(e)}


async def test_goe(host: str) -> dict:
    """Testet go-e Wallbox Verbindung und zeigt Rohwerte."""
    result: dict[str, Any] = {"host": host, "reachable": False, "raw": None, "error": None}

    tcp = await test_tcp_port(host, 80)
    if not tcp["reachable"]:
        result["error"] = tcp["error"]
        return result

    try:
        timeout = aiohttp.ClientTimeout(total=3)
        async with aiohttp.ClientSession(timeout=timeout) as s:
            async with s.get(f"http://{host}/api/status") as resp:
                result["http_status"] = resp.status
                if resp.status == 200:
                    data = await resp.json(content_type=None)
                    result["reachable"] = True
                    result["raw"] = {
                        "car": data.get("car"),
                        "amp": data.get("amp"),
                        "alw": data.get("alw"),
                        "nrg": data.get("nrg", [])[:12],
                        "wh": data.get("wh"),
                        "sse": data.get("sse"),
                        "frc": data.get("frc"),
                        "psm": data.get("psm"),
                    }
                    result["error"] = None
                else:
                    result["error"] = f"HTTP {resp.status}"
    except Exception as e:
        result["error"] = str(e)

    return result


async def scan_registers(host: str, port: int, slave_id: int, start: int, end: int) -> dict:
    """Liest einen Block von Holding-Registern und zeigt alle Nicht-0xFFFF Werte."""
    client = AsyncModbusTcpClient(host=host, port=port, timeout=3)
    result: dict[str, Any] = {"host": host, "reachable": False, "found": {}, "error": None}
    try:
        await asyncio.wait_for(client.connect(), timeout=3)
        result["reachable"] = True
        # Lese in 100er-Blöcken
        addr = start
        while addr < end:
            count = min(100, end - addr)
            try:
                r = await asyncio.wait_for(
                    client.read_holding_registers(address=addr - 1, count=count, device_id=slave_id),
                    timeout=3,
                )
                if not r.isError():
                    for i, v in enumerate(r.registers):
                        if v not in (0xFFFF, 0x0000):  # zeige nur "interessante" Werte
                            result["found"][str(addr + i)] = v
            except Exception:
                pass
            addr += count
    except Exception as e:
        result["error"] = str(e)
    finally:
        client.close()
    return result


async def test_sungrow(host: str, port: int, slave_id: int, series: str) -> dict:
    """Testet Sungrow Modbus TCP und liest alle relevanten Register."""
    result: dict[str, Any] = {
        "host": host, "port": port, "slave_id": slave_id, "series": series,
        "reachable": False, "registers": {}, "error": None,
    }

    tcp = await test_tcp_port(host, port)
    if not tcp["reachable"]:
        result["error"] = tcp["error"]
        return result

    client = AsyncModbusTcpClient(host=host, port=port, timeout=3)
    try:
        connected = await asyncio.wait_for(client.connect(), timeout=3)
        if not connected:
            result["error"] = "Modbus TCP Verbindung fehlgeschlagen"
            return result

        result["reachable"] = True
        regs = {}

        async def read(addr: int, count: int = 2, signed: bool = False) -> Any:
            try:
                r = await asyncio.wait_for(
                    client.read_holding_registers(address=addr - 1, count=count, device_id=slave_id),
                    timeout=2,
                )
                if r.isError():
                    return f"Fehler: {r}"
                if count == 1:
                    v = r.registers[0]
                    return (v - 65536) if signed and v > 32767 else v
                else:
                    raw = (r.registers[0] << 16) | r.registers[1]
                    return (raw - 4294967296) if signed and raw > 2147483647 else raw
            except Exception as e:
                return f"Exception: {e}"

        # Register die bei ALLEN Sungrow-Serien vorhanden sein sollten
        regs["5016_5017_pv_power_raw"] = await read(5016, 2)
        regs["5008_daily_yield_x10"] = await read(5008, 1)

        if series == "SH":
            regs["13003_daily_yield_x10"] = await read(13003, 1)
            regs["13009_13010_grid_power_w"] = await read(13009, 2, signed=True)
            regs["13021_13022_battery_power_w"] = await read(13021, 2, signed=True)
            regs["13022_battery_soc_x10"] = await read(13022, 1)
            regs["13023_13024_load_power_w"] = await read(13023, 2)
            regs["13001_running_state"] = await read(13001, 1)

        result["registers"] = regs
        result["error"] = None

    except Exception as e:
        result["error"] = str(e)
    finally:
        client.close()

    return result
