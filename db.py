from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv
from supabase import Client, create_client

# Resolve .env relative to this file's directory so it works regardless of
# which working directory the script is invoked from.
load_dotenv(Path(__file__).parent / ".env")


def get_client() -> Client:
    """Return a Supabase client authenticated as the service role.

    Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment
    (or .env file).  The service role key bypasses Row Level Security so the
    simulator can read all household data and write optimization_logs /
    simulation_events without needing per-user auth.
    """
    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    return create_client(url, key)
