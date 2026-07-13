import urllib.request
import re
import os

url = "https://micropython.org/download/ESP32_GENERIC/"
html = urllib.request.urlopen(url).read().decode('utf-8')
match = re.search(r'href="(/resources/firmware/ESP32_GENERIC-[^"]+\.bin)"', html)
if match:
    bin_url = "https://micropython.org" + match.group(1)
    print("Downloading", bin_url)
    urllib.request.urlretrieve(bin_url, "esp32_micropython.bin")
    print("Download complete.")
else:
    print("Could not find firmware link.")
