"""
ZenOS ML Dashboard
Kör: streamlit run dashboard/app.py
"""
import sys
import os
import uuid
import json
import base64
from datetime import datetime, timezone, date, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import streamlit as st
import plotly.express as px
import pandas as pd

from db import get_client
from engine.simulator import run_simulation

st.set_page_config(page_title="ZenOS ML Lab", page_icon="⚡", layout="wide")

st.markdown("""
<style>
@import url('https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700&display=swap');

html, body, [class*="css"], [data-testid], .stMarkdown, .stButton > button,
.stSelectbox, .stRadio, .stSlider, .stDataFrame, .stMetric, .stTabs,
h1, h2, h3, h4, h5, h6, p, span, div, label, input {
    font-family: 'Poppins', sans-serif !important;
}

[data-testid="stSidebar"] { min-width: 210px; max-width: 210px; }

.step-label {
    font-size: 11px; font-weight: 700; letter-spacing: 1.5px;
    color: #6b7280; text-transform: uppercase; margin: 18px 0 10px 0;
    display: flex; align-items: center; gap: 6px;
}
.page-title {
    font-size: 26px; font-weight: 700; margin: 0 0 18px 0;
    display: flex; align-items: center; gap: 10px;
}
.section-header {
    font-size: 16px; font-weight: 600; margin: 0 0 10px 0;
    display: flex; align-items: center; gap: 8px;
}
.run-card {
    padding: 10px 14px; border-left: 3px solid #4ade80; margin-bottom: 8px;
    background: #111827; border-radius: 0 6px 6px 0;
}
.run-card-failed { border-left-color: #f87171; }
.run-card-running { border-left-color: #fbbf24; }
.metric-icon-row {
    display: flex; align-items: center; gap: 6px;
    font-size: 12px; color: #9ca3af; margin-bottom: 2px;
}
</style>
""", unsafe_allow_html=True)

# ── Logotyp ──────────────────────────────────────────────────────────────────

_DASH_DIR    = os.path.dirname(os.path.abspath(__file__))
_ICON_DIR    = os.path.join(_DASH_DIR, "icons")
_ROOT        = os.path.dirname(_DASH_DIR)
_PARQUET_PATH = os.path.join(_ROOT, "data", "training_data_combined.parquet")
_FEAT_JSON   = os.path.join(_ROOT, "ml_model", "feature_columns.json")

def _load_svg_b64(path: str) -> str:
    try:
        with open(path, "rb") as f:
            return base64.b64encode(f.read()).decode()
    except FileNotFoundError:
        return ""

_bolt_b64 = _load_svg_b64(os.path.join(_ICON_DIR, "logo-white.svg"))
_wordmark_b64 = _load_svg_b64(os.path.join(_DASH_DIR, "zenion-logo.svg"))

if _bolt_b64 or _wordmark_b64:
    bolt_img = f'<img src="data:image/svg+xml;base64,{_bolt_b64}" style="height:38px;width:auto;">' if _bolt_b64 else ""
    word_img = f'<img src="data:image/svg+xml;base64,{_wordmark_b64}" style="height:22px;width:auto;">' if _wordmark_b64 else ""
    st.sidebar.markdown(
        f'<div style="display:flex;align-items:center;gap:10px;margin:16px 0 22px 4px;">'
        f'{bolt_img}{word_img}'
        f'</div>',
        unsafe_allow_html=True,
    )
else:
    st.sidebar.markdown("## ⚡ ZenOS")


def icon(name: str, size: int = 16) -> str:
    """Return an inline <img> tag for an SVG icon from the icons/ folder."""
    try:
        with open(os.path.join(_ICON_DIR, f"{name}.svg"), "rb") as f:
            b64 = base64.b64encode(f.read()).decode()
        return (
            f'<img src="data:image/svg+xml;base64,{b64}" '
            f'style="width:{size}px;height:{size}px;vertical-align:middle;margin-right:4px;">'
        )
    except FileNotFoundError:
        return ""


# ── Sidebar navigation ───────────────────────────────────────────────────────

page = st.sidebar.radio("", ["Simulering", "Översikt", "Resultat & Export", "ML-analys"], label_visibility="collapsed")
st.sidebar.divider()
st.sidebar.caption("Zenion AB — intern plattform")

# ── Optimeringslägen ─────────────────────────────────────────────────────────

MODES = {
    "smart_v2x": ("Nivå 3 — Full V2X", "Smart laddning + V2H under toppar + effekttariffsskydd. Kräver CCS2-port."),
    "smart_charge": ("Nivå 2 — Smart laddning", "Spotpris + förbrukningsprofil. Undviker dyra topptimmar. Passar alla bilar."),
    "smart_charge_basic": ("Nivå 1 — Grundläggande", "Laddar de 8 billigaste timmarna per dag. Ingen V2X."),
}

# ── Cachade datahämtare ──────────────────────────────────────────────────────

@st.cache_data(ttl=60)
def load_households():
    try:
        return get_client().table("household_profiles").select("id, name, price_area").order("name").execute().data or []
    except Exception as e:
        st.error(f"Databasfel: {e}")
        return []

@st.cache_data(ttl=20)
def load_recent_runs(limit=8):
    try:
        return get_client().table("simulation_runs").select(
            "id, household_id, period_from, period_to, optimization_mode, status, total_saved_sek, created_at"
        ).order("created_at", desc=True).limit(limit).execute().data or []
    except Exception:
        return []

@st.cache_data(ttl=30)
def load_all_runs():
    try:
        return get_client().table("simulation_runs").select("*").order("created_at", desc=True).execute().data or []
    except Exception:
        return []

@st.cache_data(ttl=300)
def load_training_data():
    if not os.path.exists(_PARQUET_PATH):
        return None
    return pd.read_parquet(_PARQUET_PATH)

@st.cache_data(ttl=300)
def load_logs(sim_id):
    try:
        return get_client().table("optimization_logs").select(
            "logged_at, decision, soc_pct, spot_price_sek, charge_kw, v2h_saving_sek"
        ).eq("simulation_id", sim_id).order("logged_at").execute().data or []
    except Exception:
        return []

# ── Senaste körningar (höger panel) ─────────────────────────────────────────

def latest_runs_panel(hh_map: dict):
    st.markdown(
        f'<p class="section-header">{icon("server", 16)} Senaste körningar</p>',
        unsafe_allow_html=True,
    )
    runs = load_recent_runs()
    if not runs:
        st.caption("Inga körningar ännu.")
        return
    for r in runs[:7]:
        name = hh_map.get(r.get("household_id"), "Okänt")[:24]
        sek = r.get("total_saved_sek")
        status = r.get("status", "")
        p_from = (r.get("period_from") or "")[:10]
        p_to = (r.get("period_to") or "")[:10]
        color = "#4ade80" if status == "completed" else ("#fbbf24" if status == "running" else "#6b7280")

        if status == "completed":
            status_icon = icon("trending-up", 13)
        elif status == "running":
            status_icon = icon("loader", 13)
        else:
            status_icon = icon("trending-down", 13)

        sek_str = f"{sek:.0f} SEK" if sek is not None else "—"
        st.markdown(f"""
        <div class="run-card">
            <div style="font-weight:600;font-size:13px;">{icon("house",13)}{name}</div>
            <div style="font-size:11px;color:#9ca3af;">{p_from} – {p_to}</div>
            <div style="display:flex;justify-content:space-between;margin-top:4px;align-items:center;">
                <span style="font-size:13px;color:{color};font-weight:700;">{sek_str}</span>
                <span style="font-size:11px;color:#6b7280;display:flex;align-items:center;gap:3px;">{status_icon}{status}</span>
            </div>
        </div>""", unsafe_allow_html=True)

# ── Resultat-visning ─────────────────────────────────────────────────────────

def show_results(results: list, hh_map: dict):
    st.success(f"{'Simulering' if len(results) == 1 else str(len(results)) + ' simuleringar'} klar!")

    if len(results) == 1:
        r = results[0]
        days = max(r.get("days_processed", 1) or 1, 1)
        c1, c2, c3, c4 = st.columns(4)
        c1.metric("Total besparing", f"{r.get('total_saved_sek', 0):.0f} SEK")
        c2.metric("Snitt per dag", f"{r.get('total_saved_sek', 0) / days:.1f} SEK/dag")
        c3.metric("V2H energi", f"{r.get('total_v2h_kwh', 0):.1f} kWh")
        c4.metric("Topptimmar undvikna", str(r.get("peak_hours_avoided", 0)))
    else:
        df = pd.DataFrame(results)
        df["days"] = df.get("days_processed", 1).fillna(1).clip(lower=1) if "days_processed" in df else 1
        df["sek_per_dag"] = (df["total_saved_sek"].fillna(0) / df["days"]).round(1)

        label_col = "household_name" if "household_name" in df.columns else None
        display = df[["household_name", "total_saved_sek", "sek_per_dag", "total_v2h_kwh", "peak_hours_avoided"]].copy() if label_col else \
                  df[["total_saved_sek", "sek_per_dag", "total_v2h_kwh", "peak_hours_avoided"]].copy()
        display.columns = (["Hushåll"] if label_col else []) + ["Besparing (SEK)", "SEK/dag", "V2H (kWh)", "Topptimmar undvikna"]
        st.dataframe(display.sort_values("Besparing (SEK)", ascending=False), use_container_width=True)

        col1, col2, col3 = st.columns(3)
        col1.metric("Bästa", f"{df['total_saved_sek'].max():.0f} SEK")
        col2.metric("Snitt", f"{df['total_saved_sek'].mean():.0f} SEK")
        col3.metric("Sämsta", f"{df['total_saved_sek'].min():.0f} SEK")

    st.download_button(
        f"⬇  Ladda ner resultat (JSON)",
        data=json.dumps(results, ensure_ascii=False, indent=2, default=str),
        file_name=f"zenos_sim_{date.today()}.json",
        mime="application/json",
    )

# ── Körflöde ─────────────────────────────────────────────────────────────────

def run_sims(hh_ids: list, from_date, to_date, mode: str, n_scenarios: int, hh_map: dict) -> list:
    db = get_client()
    results = []
    total = len(hh_ids) * n_scenarios
    bar = st.progress(0, "Förbereder...")
    done = 0

    for hh_id in hh_ids:
        hh_name = hh_map.get(hh_id, hh_id[:8])
        for i in range(n_scenarios):
            done += 1
            bar.progress(done / total, f"{hh_name} — scenario {i + 1}/{n_scenarios}")
            sim_id = str(uuid.uuid4())
            try:
                db.table("simulation_runs").insert({
                    "id": sim_id,
                    "household_id": hh_id,
                    "period_from": str(from_date),
                    "period_to": str(to_date),
                    "optimization_mode": mode,
                    "status": "pending",
                    "scenario_number": i + 1,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                    "scenario_params": {},
                }).execute()
                result = run_simulation(sim_id)
                result["household_name"] = hh_name
                results.append(result)
            except Exception as e:
                st.error(f"{hh_name} scenario {i + 1}: {e}")

    bar.progress(1.0, "Klar!")
    st.cache_data.clear()
    return results


# ════════════════════════════════════════════════════════════════════════════
# PAGE 1: Simulering
# ════════════════════════════════════════════════════════════════════════════

if page == "Simulering":
    households = load_households()
    hh_map = {h["id"]: h["name"] for h in households}

    main_col, gap_col, side_col = st.columns([14, 1, 5])

    with side_col:
        latest_runs_panel(hh_map)

    with main_col:
        st.markdown(
            f'<p class="page-title">{icon("lightning", 28)} ZenOS ML Lab</p>',
            unsafe_allow_html=True,
        )

        tab_enkel, tab_bulk = st.tabs(["Enkel simulering", "Bulk-körning"])

        if not households:
            with tab_enkel:
                st.warning("Inga hushåll hittades i databasen.")
            with tab_bulk:
                st.warning("Inga hushåll hittades i databasen.")
            st.stop()

        zones = ["Alla"] + sorted(set(h["price_area"] for h in households))
        default_to = date(2025, 12, 31)
        default_from = date(2025, 12, 1)

        # ── Enkel simulering ──────────────────────────────────────────────
        with tab_enkel:
            st.markdown(
                f'<p class="step-label">{icon("house", 13)} Steg 1 — Välj hushåll</p>',
                unsafe_allow_html=True,
            )

            st.markdown(
                f'<span style="font-size:12px;color:#9ca3af;">{icon("map-pin", 13)} Priszon</span>',
                unsafe_allow_html=True,
            )
            zone_e = st.radio("Zon", zones, horizontal=True, key="zone_e", label_visibility="collapsed")
            filtered_e = households if zone_e == "Alla" else [h for h in households if h["price_area"] == zone_e]

            if "sel_single" not in st.session_state:
                st.session_state.sel_single = None

            grid = st.columns(2)
            for i, hh in enumerate(filtered_e):
                with grid[i % 2]:
                    selected = st.session_state.sel_single == hh["id"]
                    btn_type = "primary" if selected else "secondary"
                    label = f"{'✓  ' if selected else ''}{hh['name']}   {hh['price_area']}"
                    if st.button(label, key=f"e_{hh['id']}", use_container_width=True, type=btn_type):
                        st.session_state.sel_single = hh["id"]
                        st.rerun()

            sel_id = st.session_state.sel_single
            if sel_id and sel_id not in {h["id"] for h in households}:
                sel_id = None

            st.divider()
            st.markdown(
                f'<p class="step-label">{icon("calendar", 13)} Steg 2 — Konfigurera</p>',
                unsafe_allow_html=True,
            )

            col_d1, col_d2 = st.columns(2)
            with col_d1:
                from_e = st.date_input("Från", value=default_from, key="from_e")
            with col_d2:
                to_e = st.date_input("Till", value=default_to, key="to_e")

            if from_e > to_e:
                st.error("Från-datum måste vara tidigare än till-datum.")
            else:
                mode_e = st.radio(
                    "Optimeringsläge", list(MODES.keys()),
                    format_func=lambda k: MODES[k][0], index=0, key="mode_e",
                )
                st.markdown(
                    f'<span style="font-size:12px;color:#9ca3af;">{icon("cable", 13)}{MODES[mode_e][1]}</span>',
                    unsafe_allow_html=True,
                )

                disabled_e = not sel_id
                btn_label_e = "⚡  Kör simulering" if sel_id else "Välj ett hushåll för att börja"

                if st.button(btn_label_e, type="primary", use_container_width=True,
                             disabled=disabled_e, key="run_e"):
                    results = run_sims([sel_id], from_e, to_e, mode_e, 1, hh_map)
                    st.session_state.enkel_results = results

            if st.session_state.get("enkel_results"):
                st.divider()
                show_results(st.session_state.enkel_results, hh_map)

        # ── Bulk-körning ──────────────────────────────────────────────────
        with tab_bulk:
            st.markdown(
                f'<p class="step-label">{icon("house", 13)} Steg 1 — Välj hushåll</p>',
                unsafe_allow_html=True,
            )

            col_z, col_btns = st.columns([4, 3])
            with col_z:
                st.markdown(
                    f'<span style="font-size:12px;color:#9ca3af;">{icon("map-pin", 13)} Priszon</span>',
                    unsafe_allow_html=True,
                )
                zone_b = st.radio("Zon", zones, horizontal=True, key="zone_b", label_visibility="collapsed")
            with col_btns:
                cb1, cb2 = st.columns(2)
                filtered_b = households if zone_b == "Alla" else [h for h in households if h["price_area"] == zone_b]
                visible_ids = {h["id"] for h in filtered_b}

                with cb1:
                    if st.button("Välj synliga", use_container_width=True, key="sel_all"):
                        for hh in filtered_b:
                            st.session_state[f"chk_{hh['id']}"] = True
                        st.rerun()
                with cb2:
                    if st.button("Avmarkera alla", use_container_width=True, key="desel_all"):
                        for hh in households:
                            st.session_state[f"chk_{hh['id']}"] = False
                        st.rerun()

            grid_b = st.columns(2)
            bulk_selected = []
            for i, hh in enumerate(filtered_b):
                with grid_b[i % 2]:
                    checked = st.checkbox(
                        f"{hh['name']}   `{hh['price_area']}`",
                        key=f"chk_{hh['id']}",
                    )
                    if checked:
                        bulk_selected.append(hh["id"])

            n_sel = len(bulk_selected)
            if n_sel > 0:
                st.caption(f"**{n_sel}** av {len(filtered_b)} hushåll valda")
            else:
                st.caption(f"0 / {len(filtered_b)} valda")

            st.divider()
            st.markdown(
                f'<p class="step-label">{icon("calendar", 13)} Steg 2 — Konfigurera</p>',
                unsafe_allow_html=True,
            )

            col_d3, col_d4 = st.columns(2)
            with col_d3:
                from_b = st.date_input("Från", value=default_from, key="from_b")
            with col_d4:
                to_b = st.date_input("Till", value=default_to, key="to_b")

            if from_b > to_b:
                st.error("Från-datum måste vara tidigare än till-datum.")
            else:
                mode_b = st.radio(
                    "Optimeringsläge", list(MODES.keys()),
                    format_func=lambda k: MODES[k][0], index=0, key="mode_b",
                )
                st.markdown(
                    f'<span style="font-size:12px;color:#9ca3af;">{icon("cable", 13)}{MODES[mode_b][1]}</span>',
                    unsafe_allow_html=True,
                )

                st.markdown(
                    f'<span style="font-size:12px;color:#9ca3af;">{icon("layers", 13)} Scenarion per hushåll</span>',
                    unsafe_allow_html=True,
                )
                n_b = st.slider("Scenarion per hushåll", 1, 100, 10, key="n_b",
                                help="Antal simuleringar per hushåll med olika slumpvariationer",
                                label_visibility="collapsed")

                total_b = n_sel * n_b
                disabled_b = n_sel == 0
                btn_label_b = f"⚡  Kör {total_b} simuleringar" if n_sel > 0 else "Välj hushåll och konfigurera för att aktivera"

                if st.button(btn_label_b, type="primary", use_container_width=True,
                             disabled=disabled_b, key="run_b"):
                    results_b = run_sims(bulk_selected, from_b, to_b, mode_b, n_b, hh_map)
                    st.session_state.bulk_results = results_b

            if st.session_state.get("bulk_results"):
                st.divider()
                show_results(st.session_state.bulk_results, hh_map)


# ════════════════════════════════════════════════════════════════════════════
# PAGE 2: Översikt
# ════════════════════════════════════════════════════════════════════════════

elif page == "Översikt":
    st.markdown(
        f'<p class="page-title">{icon("server", 26)} Översikt</p>',
        unsafe_allow_html=True,
    )

    runs = load_all_runs()
    completed = [r for r in runs if r.get("status") == "completed"]

    if not completed:
        st.info("Inga avslutade simuleringar ännu. Kör en simulering först.")
        st.stop()

    households = load_households()
    hh_map = {h["id"]: h["name"] for h in households}

    df = pd.DataFrame(completed)
    df["household"] = df["household_id"].map(hh_map).fillna("Okänt")
    df["period_from"] = pd.to_datetime(df["period_from"])
    df["period_to"] = pd.to_datetime(df["period_to"])
    df["days"] = ((df["period_to"] - df["period_from"]).dt.days + 1).clip(lower=1)
    df["sek_per_dag"] = (df["total_saved_sek"].fillna(0) / df["days"]).round(2)

    c1, c2, c3, c4 = st.columns(4)
    c1.metric("Körda simuleringar", len(completed))
    c2.metric("Snitt besparing/dag", f"{df['sek_per_dag'].mean():.1f} SEK")
    best_hh = df.groupby("household")["sek_per_dag"].mean().idxmax()
    c3.metric("Bästa hushåll", best_hh[:20])
    best_mode_key = df.groupby("optimization_mode")["sek_per_dag"].mean().idxmax()
    c4.metric("Bästa läge", MODES.get(best_mode_key, (best_mode_key,))[0][:18])

    st.divider()

    l, r = st.columns(2)
    with l:
        st.markdown(
            f'<p class="section-header">{icon("trending-up", 16)} Snitt SEK/dag per hushåll</p>',
            unsafe_allow_html=True,
        )
        hh_avg = df.groupby("household")["sek_per_dag"].mean().reset_index().sort_values("sek_per_dag", ascending=False)
        fig1 = px.bar(hh_avg, x="household", y="sek_per_dag",
                      labels={"household": "Hushåll", "sek_per_dag": "SEK/dag"},
                      color="sek_per_dag", color_continuous_scale="Greens")
        fig1.update_layout(coloraxis_showscale=False, xaxis_tickangle=-30)
        st.plotly_chart(fig1, use_container_width=True)

    with r:
        st.markdown(
            f'<p class="section-header">{icon("cable", 16)} Lägesjämförelse</p>',
            unsafe_allow_html=True,
        )
        m_avg = df.groupby("optimization_mode")["sek_per_dag"].mean().reset_index()
        m_avg["läge"] = m_avg["optimization_mode"].map({k: v[0] for k, v in MODES.items()}).fillna(m_avg["optimization_mode"])
        fig2 = px.bar(m_avg, x="läge", y="sek_per_dag",
                      labels={"läge": "Läge", "sek_per_dag": "SEK/dag"},
                      color="sek_per_dag", color_continuous_scale="Blues")
        fig2.update_layout(coloraxis_showscale=False)
        st.plotly_chart(fig2, use_container_width=True)

    st.markdown(
        f'<p class="section-header">{icon("leaf", 16)} Senaste 10 körningar</p>',
        unsafe_allow_html=True,
    )
    latest = df.head(10)[["household", "optimization_mode", "period_from", "period_to",
                           "total_saved_sek", "sek_per_dag", "status"]].copy()
    latest["period_from"] = latest["period_from"].dt.strftime("%Y-%m-%d")
    latest["period_to"] = latest["period_to"].dt.strftime("%Y-%m-%d")
    latest["optimization_mode"] = latest["optimization_mode"].map({k: v[0] for k, v in MODES.items()}).fillna(latest["optimization_mode"])
    latest["total_saved_sek"] = latest["total_saved_sek"].round(0)
    st.dataframe(latest.rename(columns={
        "household": "Hushåll", "optimization_mode": "Läge",
        "period_from": "Från", "period_to": "Till",
        "total_saved_sek": "Besparing (SEK)", "sek_per_dag": "SEK/dag", "status": "Status",
    }), use_container_width=True)


# ════════════════════════════════════════════════════════════════════════════
# PAGE 3: Resultat & Export
# ════════════════════════════════════════════════════════════════════════════

elif page == "Resultat & Export":
    st.markdown(
        f'<p class="page-title">{icon("file-text", 26)} Resultat & Export</p>',
        unsafe_allow_html=True,
    )

    runs = load_all_runs()
    if not runs:
        st.info("Inga simuleringar hittades.")
        st.stop()

    households = load_households()
    hh_map = {h["id"]: h["name"] for h in households}

    df_all = pd.DataFrame(runs)
    df_all["household"] = df_all["household_id"].map(hh_map).fillna("Okänt")
    df_all["period_from"] = pd.to_datetime(df_all["period_from"])
    df_all["period_to"] = pd.to_datetime(df_all["period_to"])
    df_all["days"] = ((df_all["period_to"] - df_all["period_from"]).dt.days + 1).clip(lower=1)
    df_all["sek_per_dag"] = (df_all["total_saved_sek"].fillna(0) / df_all["days"]).round(2)

    st.markdown(
        f'<p class="step-label">{icon("funnel", 13)} Filter</p>',
        unsafe_allow_html=True,
    )
    f1, f2, f3 = st.columns(3)
    with f1:
        hh_filter = st.selectbox("Hushåll", ["Alla"] + sorted(df_all["household"].unique().tolist()))
    with f2:
        mode_filter = st.selectbox("Läge", ["Alla"] + sorted(df_all["optimization_mode"].dropna().unique().tolist()))
    with f3:
        status_filter = st.selectbox("Status", ["Alla"] + sorted(df_all["status"].dropna().unique().tolist()))

    df_f = df_all.copy()
    if hh_filter != "Alla":
        df_f = df_f[df_f["household"] == hh_filter]
    if mode_filter != "Alla":
        df_f = df_f[df_f["optimization_mode"] == mode_filter]
    if status_filter != "Alla":
        df_f = df_f[df_f["status"] == status_filter]

    disp = df_f[["household", "optimization_mode", "period_from", "period_to",
                 "total_saved_sek", "sek_per_dag", "status", "id"]].copy()
    disp["period_from"] = disp["period_from"].dt.strftime("%Y-%m-%d")
    disp["period_to"] = disp["period_to"].dt.strftime("%Y-%m-%d")
    disp["total_saved_sek"] = disp["total_saved_sek"].round(0)
    disp["id_short"] = disp["id"].str[:8]
    st.dataframe(disp.drop(columns=["id"]).rename(columns={
        "household": "Hushåll", "optimization_mode": "Läge",
        "period_from": "Från", "period_to": "Till",
        "total_saved_sek": "Besparing (SEK)", "sek_per_dag": "SEK/dag",
        "status": "Status", "id_short": "ID",
    }), use_container_width=True)

    st.divider()
    st.markdown(
        f'<p class="section-header">{icon("battery", 16)} Detaljvy & nedladdning</p>',
        unsafe_allow_html=True,
    )

    if df_f.empty:
        st.info("Inga körningar matchar filtret.")
        st.stop()

    id_opts = {
        f"{row['household']} | {(row['period_from'] or '')[:10]}–{(row['period_to'] or '')[:10]} | {row['id'][:8]}": row["id"]
        for _, row in df_f.iterrows()
    }
    sel_label = st.selectbox("Välj simulering", list(id_opts.keys()))
    sel_id = id_opts[sel_label]
    sel = df_all[df_all["id"] == sel_id].iloc[0]

    c1, c2, c3, c4 = st.columns(4)
    c1.metric("Total besparing", f"{sel.get('total_saved_sek') or 0:.0f} SEK")
    c2.metric("SEK/dag", f"{sel.get('sek_per_dag') or 0:.1f}")
    c3.metric("V2H (kWh)", f"{sel.get('total_v2h_kwh') or 0:.1f}")
    c4.metric("Topptimmar undvikna", str(int(sel.get("peak_hours_avoided") or 0)))

    if sel.get("status") == "completed":
        logs = load_logs(sel_id)
        if logs:
            df_logs = pd.DataFrame(logs)
            df_logs["logged_at"] = pd.to_datetime(df_logs["logged_at"])
            t1, t2 = st.tabs(["SoC-kurva", "Beslut"])
            with t1:
                fig = px.line(df_logs, x="logged_at", y="soc_pct",
                              labels={"logged_at": "Tid", "soc_pct": "SoC (%)"},
                              title="Batterinivå över tid")
                fig.update_traces(line_color="#4ade80")
                st.plotly_chart(fig, use_container_width=True)
            with t2:
                counts = df_logs["decision"].value_counts().reset_index()
                counts.columns = ["Beslut", "Antal"]
                fig2 = px.pie(counts, values="Antal", names="Beslut",
                              title="Beslut", color_discrete_sequence=px.colors.qualitative.Set2)
                st.plotly_chart(fig2, use_container_width=True)
        else:
            st.info("Inga optimeringsloggar för denna körning.")

    st.divider()
    summary = {
        "simulation_id": sel_id,
        "household": sel["household"],
        "period": f"{str(sel['period_from'])[:10]} – {str(sel['period_to'])[:10]}",
        "mode": sel.get("optimization_mode"),
        "total_saved_sek": sel.get("total_saved_sek"),
        "price_savings_sek": sel.get("price_savings_sek"),
        "total_v2h_kwh": sel.get("total_v2h_kwh"),
        "avg_price_paid": sel.get("avg_price_paid"),
        "peak_hours_avoided": sel.get("peak_hours_avoided"),
        "warnings": sel.get("warnings"),
    }

    dl1, dl2, dl3 = st.columns(3)
    with dl1:
        st.download_button(
            "⬇  Summering (JSON)",
            json.dumps(summary, ensure_ascii=False, indent=2, default=str),
            file_name=f"sim_{sel_id[:8]}_summary.json", mime="application/json",
            use_container_width=True,
        )
    if sel.get("status") == "completed":
        logs = load_logs(sel_id)
        if logs:
            with dl2:
                st.download_button(
                    "⬇  Loggar (JSON)",
                    json.dumps(logs, ensure_ascii=False, indent=2, default=str),
                    file_name=f"logs_{sel_id[:8]}.json", mime="application/json",
                    use_container_width=True,
                )
            with dl3:
                st.download_button(
                    "⬇  Loggar (CSV)",
                    pd.DataFrame(logs).to_csv(index=False).encode("utf-8"),
                    file_name=f"logs_{sel_id[:8]}.csv", mime="text/csv",
                    use_container_width=True,
                )


# ════════════════════════════════════════════════════════════════════════════
# PAGE 4: ML-analys
# ════════════════════════════════════════════════════════════════════════════

elif page == "ML-analys":
    st.markdown(
        f'<p class="page-title">{icon("star", 26)} ML-analys</p>',
        unsafe_allow_html=True,
    )

    df_ml = load_training_data()

    if df_ml is None:
        st.warning(
            f"Träningsdatafilen hittades inte: `{_PARQUET_PATH}`\n\n"
            "Kör `python ml_model/extract_legacy_training_data.py` för att generera den."
        )
        st.stop()

    DECISION_COLORS = {
        "pause":            "#6B7280",
        "charge":           "#F59E0B",
        "v2h":              "#3B82F6",
        "emergency_charge": "#f87171",
    }
    SCENARIO_NAMES = {
        0: "normal", 1: "wfh",      2: "sick",
        3: "oversleep", 4: "overtime", 5: "day_off", 6: "long_sick",
    }

    tab1, tab2, tab3, tab4 = st.tabs(["Beslutsmönster", "SoC-analys", "Prisrespons", "Modellkvalitet"])

    # ── TAB 1 — Beslutsmönster ───────────────────────────────────────────────
    with tab1:
        col1, col2 = st.columns(2)

        with col1:
            st.markdown(
                f'<p class="section-header">{icon("lightning", 16)} Beslutsfördelning per timme</p>',
                unsafe_allow_html=True,
            )

            if "decision" in df_ml.columns and "hour_of_day" in df_ml.columns:
                df_hour = df_ml.copy()
                if "reason" in df_hour.columns:
                    df_hour = df_hour[df_hour["reason"] != "cable_disconnected"]

                hour_dec = (
                    df_hour.groupby(["hour_of_day", "decision"])
                    .size()
                    .reset_index(name="count")
                )
                hour_total = hour_dec.groupby("hour_of_day")["count"].transform("sum")
                hour_dec["pct"] = (hour_dec["count"] / hour_total * 100).round(2)

                fig_hd = px.area(
                    hour_dec, x="hour_of_day", y="pct", color="decision",
                    color_discrete_map=DECISION_COLORS,
                    labels={"hour_of_day": "Timme", "pct": "Andel (%)", "decision": "Beslut"},
                    title="Beslutsfördelning per timme",
                    height=350,
                )
                fig_hd.update_layout(
                    hovermode="x unified",
                    legend_title_text="Beslut",
                    xaxis=dict(tickmode="linear", tick0=0, dtick=1),
                )
                for y_val in [25, 50, 75]:
                    fig_hd.add_hline(
                        y=y_val, line_dash="dot",
                        line_color="rgba(255,255,255,0.25)", line_width=1,
                    )
                fig_hd.add_vrect(
                    x0=7, x1=16, fillcolor="white", opacity=0.05, line_width=0,
                    annotation_text="Bil borta", annotation_position="top left",
                    annotation_font_color="white", annotation_font_size=11,
                )
                for x_val, label in [(2, "Nattladdning"), (10, "Borta"), (18, "V2H kväll")]:
                    fig_hd.add_annotation(
                        x=x_val, y=1.06,
                        xref="x", yref="paper",
                        text=label,
                        showarrow=False,
                        font=dict(size=10, color="#9ca3af"),
                        xanchor="center",
                    )
                st.plotly_chart(fig_hd, use_container_width=True, config={"displayModeBar": False})
                st.caption(
                    "Visar hur Numiz fördelar sina beslut varje timme på dygnet. "
                    "Gult = laddning (billiga natttimmar), blått = V2H (dyr kväll, "
                    "batteriet driver huset), grått = standby."
                )
            else:
                st.info("Kolumnerna `decision` eller `hour_of_day` saknas i träningsdatan.")

        with col2:
            st.markdown(
                f'<p class="section-header">{icon("layers", 16)} Beslut per scenario</p>',
                unsafe_allow_html=True,
            )

            if "decision" in df_ml.columns:
                if "scenario_type" in df_ml.columns and df_ml["scenario_type"].notna().sum() > 100:
                    scenario_col = "scenario_type"
                else:
                    st.info("Scenariodata saknas för äldre simuleringar — kör nya simuleringar för att se scenariovariationer.")
                    scenario_col = None

                if scenario_col is not None:
                    sc_dec = (
                        df_ml.groupby([scenario_col, "decision"])
                        .size()
                        .reset_index(name="count")
                    )
                    sc_total = sc_dec.groupby(scenario_col)["count"].transform("sum")
                    sc_dec["pct"] = (sc_dec["count"] / sc_total * 100).round(2)

                    fig_sc = px.bar(
                        sc_dec, x=scenario_col, y="pct", color="decision",
                        color_discrete_map=DECISION_COLORS, barmode="group",
                        labels={scenario_col: "Scenario", "pct": "Andel (%)", "decision": "Beslut"},
                        title="Beslut per scenario",
                        height=320,
                    )
                    fig_sc.update_layout(
                        legend_title_text="Beslut",
                        xaxis_tickangle=-30,
                    )
                    st.plotly_chart(fig_sc, use_container_width=True, config={"displayModeBar": False})
                    st.caption(
                        "Jämför Numiz beteende i olika vardagssituationer. "
                        "'wfh' och 'day_off' ökar förbrukningen under dagen, "
                        "medan 'overtime' förskjuter hemkomst och V2H-fönstret."
                    )
            else:
                st.info("Kolumnen `decision` saknas i träningsdatan.")

    # ── TAB 2 — SoC-analys ───────────────────────────────────────────────────
    with tab2:
        if "soc_pct" not in df_ml.columns or "decision" not in df_ml.columns:
            st.info("Nödvändiga kolumner saknas.")
        else:
            st.markdown(
                f'<p class="section-header">{icon("battery", 16)} SoC vs beslut</p>',
                unsafe_allow_html=True,
            )

            fig_strip = px.strip(
                df_ml.sample(min(len(df_ml), 8000), random_state=42),
                x="soc_pct", y="decision",
                color="decision", color_discrete_map=DECISION_COLORS,
                labels={"soc_pct": "SoC (%)", "decision": "Beslut"},
                title="Vid vilken SoC tar systemet vilket beslut?",
            )
            fig_strip.update_traces(jitter=0.4, marker_size=3, marker_opacity=0.4)
            st.plotly_chart(fig_strip, use_container_width=True)

            fig_hist = px.histogram(
                df_ml, x="soc_pct", color="decision",
                color_discrete_map=DECISION_COLORS, nbins=50, barmode="overlay",
                opacity=0.7,
                labels={"soc_pct": "SoC (%)", "count": "Antal", "decision": "Beslut"},
                title="SoC-distribution per beslut",
            )
            fig_hist.update_layout(legend_title_text="Beslut")
            st.plotly_chart(fig_hist, use_container_width=True)

            st.divider()
            n_total = len(df_ml)
            n_soc_viol  = int(df_ml["soc_violation"].sum())  if "soc_violation"  in df_ml.columns else 0
            n_morn_fail = int(df_ml["morning_failure"].sum()) if "morning_failure" in df_ml.columns else 0

            kp1, kp2 = st.columns(2)
            kp1.metric(
                "SoC-brott (under min_soc)",
                f"{n_soc_viol:,}",
                delta=f"{n_soc_viol / n_total * 100:.1f}% av alla rader",
                delta_color="inverse",
            )
            kp2.metric(
                "Morgonfel (ej full vid avresa)",
                f"{n_morn_fail:,}",
                delta=f"{n_morn_fail / n_total * 100:.1f}% av alla rader",
                delta_color="inverse",
            )

    # ── TAB 3 — Prisrespons ──────────────────────────────────────────────────
    with tab3:
        if "spot_price_sek" not in df_ml.columns or "decision" not in df_ml.columns:
            st.info("Nödvändiga kolumner saknas.")
        else:
            st.markdown(
                f'<p class="section-header">{icon("trending-up", 16)} Prisrespons</p>',
                unsafe_allow_html=True,
            )

            fig_pr = px.strip(
                df_ml.sample(min(len(df_ml), 8000), random_state=42),
                x="spot_price_sek", y="decision",
                color="decision", color_discrete_map=DECISION_COLORS,
                labels={"spot_price_sek": "Spotpris (SEK/kWh)", "decision": "Beslut"},
                title="Hur reagerar systemet på elpriset?",
            )
            fig_pr.update_traces(jitter=0.4, marker_size=3, marker_opacity=0.4)
            st.plotly_chart(fig_pr, use_container_width=True)

            st.divider()

            if "price_vs_daily_avg" in df_ml.columns:
                df_pv = df_ml[df_ml["price_vs_daily_avg"].notna()].copy()
                bins   = [i / 10 for i in range(0, 21)]          # 0.0 … 2.0
                labels = [f"{i / 10:.1f}" for i in range(0, 20)] # bin labels
                df_pv["price_bin"] = pd.cut(
                    df_pv["price_vs_daily_avg"].clip(0, 2.0),
                    bins=bins, labels=labels, include_lowest=True,
                )
                v2h_rate = (
                    df_pv.groupby("price_bin", observed=True)
                    .apply(lambda x: (x["decision"] == "v2h").mean() * 100)
                    .reset_index(name="v2h_rate")
                )
                v2h_rate["price_bin"] = v2h_rate["price_bin"].astype(str)

                fig_v2h = px.line(
                    v2h_rate, x="price_bin", y="v2h_rate",
                    markers=True,
                    labels={"price_bin": "Pris vs dagsnitt", "v2h_rate": "V2H-frekvens (%)"},
                    title="V2H-frekvens vs relativt pris",
                )
                fig_v2h.update_traces(line_color="#60a5fa", marker_color="#60a5fa")
                st.plotly_chart(fig_v2h, use_container_width=True)

    # ── TAB 4 — Modellkvalitet ───────────────────────────────────────────────
    with tab4:
        st.markdown(
            f'<p class="section-header">{icon("star", 16)} Feature importance</p>',
            unsafe_allow_html=True,
        )

        FEAT_IMP = {
            "price_vs_daily_min":      3462,
            "soc_margin_above_floor":  3174,
            "price_vs_daily_avg":      3112,
            "soc_pct":                 3031,
            "soc_deficit_to_target":   2990,
            "house_consumption_kw":    2867,
            "spot_price_sek":          2690,
            "hours_until_leave":       2680,
            "hour_of_day":             2525,
            "total_cost_per_kwh":      1930,
        }

        fi_df = pd.DataFrame(
            sorted(FEAT_IMP.items(), key=lambda x: x[1]),
            columns=["Feature", "Importance (weight)"],
        )
        fig_fi = px.bar(
            fi_df, x="Importance (weight)", y="Feature", orientation="h",
            color="Importance (weight)", color_continuous_scale="Greens",
            title="Feature importance — vad påverkar Numiz beslut mest?",
        )
        fig_fi.update_layout(coloraxis_showscale=False, yaxis_title="")
        st.plotly_chart(fig_fi, use_container_width=True)

        # Load feature_columns.json to show active feature count
        try:
            with open(_FEAT_JSON) as f:
                feat_list = json.load(f)
            st.caption(f"Aktiva features i senaste modell: **{len(feat_list)}** st — {', '.join(feat_list)}")
        except FileNotFoundError:
            st.caption("feature_columns.json ej funnen — träna modellen för att generera den.")

        st.divider()
        m1, m2, m3, m4 = st.columns(4)
        m1.metric("Träningsrader",     "38 028")
        m2.metric("V2H precision",     "93%")
        m3.metric("Charge precision",  "72%")
        m4.metric("V2H rate (safety)", "41.8%")
