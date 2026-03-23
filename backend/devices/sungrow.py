"""
Sungrow SH-series hybrid inverter – Modbus TCP client.

Reads input registers (FC 0x04) from each inverter independently.
Master (slave_id=1) has battery; slave (slave_id=2) is PV-only.
"""

import asyncio
import logging
from dataclasses import dataclass
from typing import Optional

from pymodbus.client import AsyncModbusTcpClient
from pymodbus.exceptions import ModbusException

from config import SungrowConfig

log = logging.getLogger(__name__)

# Input register map (FC 0x04, 1-based addresses, SH series)
# (address, count, scale, signed)
_REG_PV_POWER   = (5016, 2, 1.0, False)   # Total DC power (W), U32
_REG_GRID_POWER = (13009, 2, 1.0, True)    # Meter power (W), S32; >0=export, <0=import
_REG_BATT_SOC   = (13022, 1, 0.1, False)   # Battery SOC (%), U16 × 0.1


@dataclass
class InverterData:
    inverter_id: str
    name: str
    online: bool = False
    pv_power_w: float = 0.0
    grid_power_w: float = 0.0        # >0 export to grid, <0 import from grid
    battery_soc_pct: Optional[float] = None   # master only
    error: Optional[str] = None


class SungrowClient:
    def __init__(self, cfg: SungrowConfig):
        self.cfg = cfg
        self._client: Optional[AsyncModbusTcpClient] = None
        self._lock = asyncio.Lock()

    async def _connect(self) -> AsyncModbusTcpClient:
        if self._client is None or not self._client.connected:
            self._client = AsyncModbusTcpClient(
                host=self.cfg.host,
                port=self.cfg.port,
                timeout=5,
            )
            await self._client.connect()
        return self._client

    async def _read(self, address: int, count: int, scale: float, signed: bool) -> Optional[float]:
        try:
            client = await self._connect()
            # pymodbus uses 0-based addresses; docs are 1-based
            result = await client.read_input_registers(
                address=address - 1,
                count=count,
                device_id=self.cfg.slave_id,
            )
            if result.isError():
                return None
            regs = result.registers
            if count == 1:
                raw = regs[0]
                if signed and raw > 32767:
                    raw -= 65536
            else:
                raw = (regs[0] << 16) | regs[1]
                if signed and raw > 2_147_483_647:
                    raw -= 4_294_967_296
            return raw * scale
        except (ModbusException, Exception) as exc:
            log.debug("Modbus read %s slave %d: %s", self.cfg.host, self.cfg.slave_id, exc)
            return None

    async def read(self) -> InverterData:
        data = InverterData(inverter_id=self.cfg.id, name=self.cfg.name)
        if not self.cfg.enabled:
            return data

        async with self._lock:
            try:
                pv = await self._read(*_REG_PV_POWER)
                if pv is None:
                    data.error = "Modbus nicht erreichbar"
                    return data

                data.online = True
                data.pv_power_w = max(0.0, pv)

                grid = await self._read(*_REG_GRID_POWER)
                if grid is not None:
                    data.grid_power_w = grid

                # Battery SOC only on master (slave returns None gracefully)
                soc = await self._read(*_REG_BATT_SOC)
                if soc is not None:
                    data.battery_soc_pct = soc

            except Exception as exc:
                data.error = str(exc)
                log.warning("Sungrow %s Lesefehler: %s", self.cfg.host, exc)
                if self._client:
                    self._client.close()
                    self._client = None

        return data

    async def close(self) -> None:
        if self._client:
            self._client.close()
            self._client = None
