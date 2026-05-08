#!/bin/bash
cd "$(dirname "$0")/.."
PORT=5000 npx next dev -p 5000 -H 0.0.0.0 --webpack
