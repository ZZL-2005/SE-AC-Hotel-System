import requests

BASE_URL = "http://localhost:8000"
resp = requests.get(f"{BASE_URL}/monitor/hyperparams")

print("Status:", resp.status_code)
print("Headers:", resp.headers)

try:
    print("JSON:", resp.json())
except ValueError:
    print("Body:", resp.text)