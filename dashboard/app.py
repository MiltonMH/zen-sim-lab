"""
ZenOS ML Dashboard
Kör: streamlit run dashboard/app.py
"""
import streamlit as st
import plotly.express as px
import json

st.set_page_config(page_title="ZenOS ML Lab", page_icon="zap", layout="wide")
st.title("ZenOS ML Lab")
st.caption("Zenion AB — intern simulerings- och traningsplattform")

page = st.sidebar.radio("Valj vy:", ["Oversikt", "Simuleringsresultat", "ML Modell"])

if page == "Oversikt":
    col1, col2, col3 = st.columns(3)
    col1.metric("Snitt besparing", "30.8 SEK/dag")
    col2.metric("V2H timmar/dag", "5.4h")
    col3.metric("Morgongaranti", "97.1%")

elif page == "Simuleringsresultat":
    st.header("Analysera JSON fran bulk-export")
    json_input = st.text_area("Klistra in JSON:", height=200)
    
    if json_input and st.button("Analysera"):
        try:
            data = json.loads(json_input)
            runs = data.get('runs', [])
            rows = []
            for r in runs:
                results = r.get('results', [])
                if results:
                    snitt = sum(res.get('total_saved_sek', 0) for res in results) / len(results)
                    days = results[0].get('days_processed', 30)
                    rows.append({'Hushall': r['household'][:20], 'SEK_dag': round(snitt/days, 1)})
            
            import pandas as pd
            df = pd.DataFrame(rows).sort_values('SEK_dag', ascending=False)
            fig = px.bar(df, x='Hushall', y='SEK_dag', title='Besparing per hushall', color='SEK_dag', color_continuous_scale='Greens')
            st.plotly_chart(fig, use_container_width=True)
            st.dataframe(df)
        except Exception as e:
            st.error(f"Fel: {e}")

elif page == "ML Modell":
    st.header("ML Modell")
    st.progress(0.3, "Datainsamling pagar - 30%")
    st.markdown("1. Simuleringsmotor klar\n2. Traning pagar\n3. ML-modell nasta steg")
