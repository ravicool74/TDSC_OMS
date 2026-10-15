import asyncio
import os
from pathlib import Path
from dotenv import load_dotenv
import certifi
from motor.motor_asyncio import AsyncIOMotorClient

from customer_portal_core import (
    init_customer_portal_indexes,
    MASTER_SERVICES_CATALOGUE,
)
from service_request_routes import ensure_customer_account, seed_master_services

ROOT_DIR = Path("E:/MY PROJECTS/tdscoms/backend")
load_dotenv(ROOT_DIR / ".env")

mongo_url = os.environ.get("MONGO_URL")
db_name = os.environ.get("DB_NAME", "triveni_fms")

async def run_backfill():
    client = AsyncIOMotorClient(mongo_url, tlsCAFile=certifi.where())
    db = client[db_name]

    print("Step 1: Initializing customer portal indexes...")
    await init_customer_portal_indexes(db)
    print("Indexes initialized successfully.")

    print("\nStep 2: Seeding / verifying 27 master services catalogue...")
    await seed_master_services(db)
    srv_count = await db.service_catalogue.count_documents({})
    print(f"Total services in catalogue: {srv_count}")

    print("\nStep 3: Backfilling customer login accounts for existing customers...")
    custs = await db.customers.find({}, {"_id": 0}).to_list(100)
    print(f"Total customers found: {len(custs)}")

    created_count = 0
    existing_count = 0

    for c in custs:
        # Check if already has user account
        u = await db.users.find_one({"customer_id": c.get("id")}, {"_id": 0})
        if u:
            existing_count += 1
            print(f"  Customer {c.get('customer_code')} ({c.get('name')}): already has User ID {u.get('user_id')}")
        else:
            acc = await ensure_customer_account(db, c)
            created_count += 1
            print(f"  Customer {c.get('customer_code')} ({c.get('name')}): created new User ID {acc.get('user_id')}, temp password generated.")

    print(f"\nBackfill Complete: {created_count} accounts created, {existing_count} already existed.")

asyncio.run(run_backfill())
