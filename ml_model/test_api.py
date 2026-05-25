import requests
from datetime import datetime

now = datetime.now()
url = f"https://www.elprisetjustnu.se/api/v1/prices/{now.year}/{now.month:02d}-{now.day:02d}_SE4.json"

print(f"Anropar: {url}")
response = requests.get(url)
print(f"Status: {response.status_code}")

if response.status_code == 200:
    data = response.json()
    print(f"Första elementet: {data[0]}")
    print(f"Alla nycklar: {data[0].keys()}")
else:
    print("Misslyckades")