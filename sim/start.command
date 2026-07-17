#!/bin/bash
# Start local HTTP server and open the FPV sim in browser
cd "$(dirname "$0")"
open http://localhost:8080/fpv.html
python3 -m http.server 8080
