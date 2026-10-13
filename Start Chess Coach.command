#!/bin/bash
# Double-click in Finder to start Chess Coach and open it in your browser.
# Keep the Terminal window it opens running while you play; close it (or press
# Control+C) to stop the app.

cd "$(dirname "$0")" || exit 1
# Make sure Node is found whether it came from the nodejs.org installer or Homebrew.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
URL="http://localhost:5173"

# Already running? Open it, unless a newer version is waiting: then stop the running
# copy so it can be updated and restarted below.
if curl -s -o /dev/null "$URL"; then
  git fetch --quiet 2>/dev/null
  if [ "$(git rev-parse HEAD)" = "$(git rev-parse '@{u}' 2>/dev/null || git rev-parse HEAD)" ]; then
    open "$URL"
    exit 0
  fi
  echo "A newer version of Chess Coach is available. Stopping the running copy to update it..."
  for port in 5173 3001; do
    pids=$(lsof -ti "tcp:$port" 2>/dev/null)
    [ -n "$pids" ] && kill $pids 2>/dev/null
  done
  sleep 2
fi

echo "Updating Chess Coach..."
git checkout -- package-lock.json 2>/dev/null
git pull --ff-only || echo "(Could not check for updates; starting the version you have.)"
if ! npm install --no-audit --no-fund; then
  echo
  echo "Installing the app's libraries failed (see above). Press any key to close."
  read -r -n 1
  exit 1
fi

# Open the browser as soon as the app answers (up to a minute).
(
  for _ in $(seq 1 60); do
    if curl -s -o /dev/null "$URL"; then open "$URL"; break; fi
    sleep 1
  done
) &

echo "Starting Chess Coach. Leave this window open while you play."
npm run dev
