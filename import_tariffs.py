from db import get_client
import pandas as pd
import numpy as np

def import_tariffs():
    supabase = get_client()
    
    # Läs CSV-filen
    df = pd.read_csv('grid_tariffs_supabase_ready.csv')
    
    # Lista över kolumner som ska bort (STRICT!)
    columns_to_remove = ['source_id', 'raw_response', 'valid_to']
    
    for col in columns_to_remove:
        if col in df.columns:
            df = df.drop(columns=[col])
            print(f"🗑️ Tog bort kolumn: {col}")
    
    # Konvertera alla kolumner som borde vara heltal
    int_columns = ['hour_of_day', 'month_from', 'month_to']
    for col in int_columns:
        if col in df.columns:
            df[col] = df[col].fillna(0).astype(int)
    
    # Byt ut NaN mot None
    df = df.replace({np.nan: None})
    
    # Konvertera till dict och RENSA noggrant
    records = df.to_dict(orient='records')
    
    # Rensa varje record - ta bort alla kolumner som kan strula
    cleaned_records = []
    allowed_columns = ['id', 'grid_company', 'hour_of_day', 'is_weekend', 
                       'tariff_sek_kwh', 'valid_from', 'tariff_type', 
                       'month_from', 'month_to', 'season', 'fixed_fee_sek_month', 
                       'peak_fee_sek_kw']
    
    for record in records:
        cleaned = {}
        for k, v in record.items():
            # Bara tillåtna kolumner och värden som inte är None
            if k in allowed_columns and v is not None and not (isinstance(v, float) and pd.isna(v)):
                # Tvinga heltal
                if k in ['hour_of_day', 'month_from', 'month_to']:
                    v = int(v)
                cleaned[k] = v
        cleaned_records.append(cleaned)
    
    print(f"📋 Första recordet: {cleaned_records[0] if cleaned_records else 'Inga'}")
    print(f"📋 Kolumner i första recordet: {list(cleaned_records[0].keys()) if cleaned_records else 'Inga'}")
    
    # Ladda upp
    batch_size = 50
    total = 0
    for i in range(0, len(cleaned_records), batch_size):
        batch = cleaned_records[i:i+batch_size]
        result = supabase.table('grid_tariffs').insert(batch).execute()
        total += len(result.data)
        print(f"📦 Batch {i//batch_size + 1}: {len(result.data)} rader")
    
    print(f"✅ KLART! {total} rader importerade!")

if __name__ == "__main__":
    import_tariffs()