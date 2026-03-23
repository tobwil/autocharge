from __future__ import annotations
import os
import time
from pathlib import Path

from sqlalchemy import Column, Float, Integer, String, select, text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

DB_PATH = Path(os.environ.get("DB_PATH", "/data/autocharge.db"))


class Base(DeclarativeBase):
    pass


class Reading(Base):
    __tablename__ = "readings"
    id = Column(Integer, primary_key=True, autoincrement=True)
    ts = Column(Integer, nullable=False, index=True)
    solar_w = Column(Float, nullable=False, default=0)
    available_w = Column(Float, nullable=False, default=0)
    ev_w = Column(Float, nullable=False, default=0)
    mode = Column(String, nullable=False, default="solar")


_engine = None
_Session = None


async def init_db() -> None:
    global _engine, _Session
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    _engine = create_async_engine(f"sqlite+aiosqlite:///{DB_PATH}", echo=False)
    _Session = sessionmaker(_engine, class_=AsyncSession, expire_on_commit=False)
    async with _engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.execute(text(
            "DELETE FROM readings WHERE ts < strftime('%s','now') - 7*86400"
        ))


async def save_reading(solar_w: float, available_w: float, ev_w: float, mode: str) -> None:
    async with _Session() as s:
        s.add(Reading(ts=int(time.time()), solar_w=solar_w, available_w=available_w,
                      ev_w=ev_w, mode=mode))
        await s.commit()


async def get_readings(hours: int = 24) -> list[dict]:
    cutoff = int(time.time()) - hours * 3600
    async with _Session() as s:
        result = await s.execute(
            select(Reading).where(Reading.ts >= cutoff).order_by(Reading.ts)
        )
        rows = result.scalars().all()
        return [{"ts": r.ts, "solar_w": r.solar_w, "available_w": r.available_w,
                 "ev_w": r.ev_w, "mode": r.mode} for r in rows]
