# ZenOS ML — Zenion AB

Python-projekt för att träna och validera ZenOS optimeringsmodell.

## Struktur
```
zenios-ml/
├── config.py       # Motorns konstanter (DC_EFFICIENCY, ENERGY_TAX_SEK, m.fl.)
├── db.py           # Supabase-klient (service role)
├── schemas/        # Dataklasser: HouseholdProfile, EVModel, SpotPrice, m.fl.
├── engine/         # Simuleringsmotorn
│   ├── decision.py #   Timme-för-timme beslutslogik (charge/v2h/pause)
│   ├── planner.py  #   Daglig lookahead-planering (smart_v2x)
│   └── simulator.py#   Yttre loop — läser data, kör motor, skriver resultat
├── scripts/        # Python-scripts
│   ├── fetch_spot_prices.py  # Hämtar spotpriser från elprisetjustnu.se
│   └── run_simulation.py     # CLI-startpunkt för simulering
├── data/           # Exporterad data från Supabase
├── models/         # Tränade ML-modeller (.pkl / .joblib)
├── notebooks/      # Jupyter notebooks för analys
├── dashboard/      # Streamlit dashboard
└── .env            # API-nycklar (läggs INTE upp på GitHub)
```

## Kom igång
```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

## Miljövariabler (.env)
```
SUPABASE_URL=din_url_här
SUPABASE_KEY=din_nyckel_här
```
