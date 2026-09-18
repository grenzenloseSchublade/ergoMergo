#!/usr/bin/env python3
"""V0-Spike: GATT-Dump und FTMS-Faehigkeitscheck fuer den Wahoo KICKR CORE 2.

Liest alle Dienste/Characteristics, dekodiert die FTMS-Feature-Bits und
schreibt das Ergebnis nach docs/services.json. Mit --control werden
zusaetzlich Steuerbefehle getestet (Request Control, Start, 100 W Ziel,
Widerstandsstufe) und die Antwortcodes protokolliert — der Trainer
reagiert dabei spuerbar.

    pip install bleak
    python3 tools/gatt_dump.py [--control] [--name KICKR]
"""

import argparse
import asyncio
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from bleak import BleakClient, BleakScanner

FTMS_SERVICE = "00001826-0000-1000-8000-00805f9b34fb"
CH_FEATURE = "00002acc-0000-1000-8000-00805f9b34fb"
CH_RES_RANGE = "00002ad6-0000-1000-8000-00805f9b34fb"
CH_POWER_RANGE = "00002ad8-0000-1000-8000-00805f9b34fb"
CH_CONTROL = "00002ad9-0000-1000-8000-00805f9b34fb"
CH_BIKE_DATA = "00002ad2-0000-1000-8000-00805f9b34fb"
WCPS_CONTROL = "a026e005-0a7d-4ab3-97fa-f1500f9feb8b"

# FTMS 4.3.1.1 Fitness Machine Features (erste 4 Bytes)
MACHINE_FEATURES = [
    "avg_speed", "cadence", "total_distance", "inclination", "elevation_gain",
    "pace", "step_count", "resistance_level", "stride_count", "expended_energy",
    "heart_rate", "metabolic_equivalent", "elapsed_time", "remaining_time",
    "power_measurement", "force_on_belt_and_power_output", "user_data_retention",
]
# FTMS 4.3.1.2 Target Setting Features (zweite 4 Bytes)
TARGET_FEATURES = [
    "speed_target", "inclination_target", "resistance_target", "power_target",
    "heart_rate_target", "targeted_expended_energy", "targeted_step_number",
    "targeted_stride_number", "targeted_distance", "targeted_training_time",
    "targeted_time_two_hr_zones", "targeted_time_three_hr_zones",
    "targeted_time_five_hr_zones", "indoor_bike_simulation",
    "wheel_circumference", "spin_down_control", "targeted_cadence",
]

RESULT_CODES = {
    1: "Success", 2: "Op Code Not Supported", 3: "Invalid Parameter",
    4: "Operation Failed", 5: "Control Not Permitted",
}


def decode_bits(data: bytes, offset: int, names: list[str]) -> dict:
    value = int.from_bytes(data[offset:offset + 4], "little")
    return {name: bool(value >> i & 1) for i, name in enumerate(names)}


def s16(data: bytes, i: int) -> int:
    return int.from_bytes(data[i:i + 2], "little", signed=True)


def u16(data: bytes, i: int) -> int:
    return int.from_bytes(data[i:i + 2], "little")


async def control_test(client: BleakClient, result: dict) -> None:
    """Steuersequenz: 0x00 Request Control -> 0x07 Start -> 0x05 100 W -> 0x04 Stufe 1."""
    responses: asyncio.Queue = asyncio.Queue()

    def on_indication(_, data: bytearray):
        responses.put_nowait(bytes(data))

    await client.start_notify(CH_CONTROL, on_indication)

    async def send(label: str, payload: bytes) -> None:
        await client.write_gatt_char(CH_CONTROL, payload, response=True)
        try:
            resp = await asyncio.wait_for(responses.get(), timeout=5)
            # Antwortformat: 0x80, angefragter OpCode, Result Code
            code = resp[2] if len(resp) >= 3 else None
            entry = {"payload": payload.hex(), "response": resp.hex(),
                     "result": RESULT_CODES.get(code, f"unbekannt ({code})")}
        except asyncio.TimeoutError:
            entry = {"payload": payload.hex(), "response": None,
                     "result": "keine Indication innerhalb 5 s"}
        result["control_test"][label] = entry
        print(f"  {label}: {entry['result']}")

    result["control_test"] = {}
    await send("request_control_0x00", bytes([0x00]))
    await send("start_0x07", bytes([0x07]))
    await send("set_target_power_100W_0x05", bytes([0x05]) + (100).to_bytes(2, "little", signed=True))
    await asyncio.sleep(3)
    await send("set_resistance_level_1_0x04", bytes([0x04, 0x01]))
    await asyncio.sleep(2)
    await send("stop_0x08", bytes([0x08, 0x01]))
    await client.stop_notify(CH_CONTROL)


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", default="KICKR", help="Namensfilter fuer den Scan")
    ap.add_argument("--control", action="store_true",
                    help="Steuerbefehle testen (Trainer reagiert spuerbar)")
    ap.add_argument("--out", default=str(Path(__file__).resolve().parent.parent / "docs" / "services.json"))
    args = ap.parse_args()

    print(f"Suche Geraet mit '{args.name}' im Namen (20 s) ...")
    device = await BleakScanner.find_device_by_filter(
        lambda d, ad: bool(d.name and args.name in d.name), timeout=20)
    if device is None:
        sys.exit("Kein Geraet gefunden. Trainer wach? Wahoo-App/Uhr getrennt? (max. 3 BLE-Slots)")

    print(f"Gefunden: name={device.name!r} address={device.address}")
    result = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "device_name": device.name,
        "address": device.address,
        "services": {},
    }

    async with BleakClient(device) as client:
        for svc in client.services:
            result["services"][svc.uuid] = {
                "description": svc.description,
                "characteristics": {
                    ch.uuid: {"properties": list(ch.properties), "description": ch.description}
                    for ch in svc.characteristics
                },
            }

        chars = {ch.uuid for svc in client.services for ch in svc.characteristics}
        result["has_ftms"] = FTMS_SERVICE in {s.uuid for s in client.services}
        result["has_wcps"] = WCPS_CONTROL in chars
        print(f"FTMS-Dienst: {result['has_ftms']} · Wahoo-WCPS-Characteristic: {result['has_wcps']}")

        if CH_FEATURE in chars:
            raw = bytes(await client.read_gatt_char(CH_FEATURE))
            result["fitness_machine_features"] = {
                "raw": raw.hex(),
                "machine": decode_bits(raw, 0, MACHINE_FEATURES),
                "target": decode_bits(raw, 4, TARGET_FEATURES),
            }
            t = result["fitness_machine_features"]["target"]
            print(f"Feature-Bits: power_target={t['power_target']} "
                  f"resistance_target={t['resistance_target']} "
                  f"simulation={t['indoor_bike_simulation']}")

        if CH_POWER_RANGE in chars:
            raw = bytes(await client.read_gatt_char(CH_POWER_RANGE))
            result["supported_power_range"] = {
                "raw": raw.hex(), "min_w": s16(raw, 0), "max_w": s16(raw, 2), "step_w": u16(raw, 4)}
            print("Power Range:", result["supported_power_range"])

        if CH_RES_RANGE in chars:
            raw = bytes(await client.read_gatt_char(CH_RES_RANGE))
            result["supported_resistance_range"] = {
                "raw": raw.hex(),
                "min": s16(raw, 0) / 10, "max": s16(raw, 2) / 10, "step": u16(raw, 4) / 10}
            print("Resistance Range:", result["supported_resistance_range"])
        else:
            result["supported_resistance_range"] = None
            print("Keine Supported Resistance Level Range (0x2AD6) vorhanden.")

        if args.control:
            if CH_CONTROL in chars:
                print("Steuertest laeuft ...")
                await control_test(client, result)
            else:
                print("Kein FTMS Control Point (0x2AD9) gefunden — Steuertest uebersprungen.")

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, indent=2, ensure_ascii=False))
    print(f"Geschrieben: {out}")


if __name__ == "__main__":
    asyncio.run(main())
