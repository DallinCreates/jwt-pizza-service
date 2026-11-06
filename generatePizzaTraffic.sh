#!/bin/bash

# Simulates JWT Pizza traffic until CTRL-C is pressed.
# Assumes the database was populated by generatePizzaData.sh.

if [ -z "$1" ]; then
  echo "Usage: $0 <host>"
  echo "Example: $0 http://localhost:3000"
  exit 1
fi
host=$1

# Give each loop its own process group, so cleanup also stops the loop's current sleep.
set -m

pids=()

cleanup() {
  echo "Terminating background processes..."
  for pid in "${pids[@]}"; do
    kill -- "-$pid" 2>/dev/null
  done
  exit 0
}
trap cleanup INT TERM

# Logs in and prints the auth token, or nothing if the login failed.
login() {
  curl -s -X PUT "$host/api/auth" -d "{\"email\":\"$1\", \"password\":\"$2\"}" -H 'Content-Type: application/json' |
    sed -n 's/.*"token":"\([^"]*\)".*/\1/p'
}

# Logs out and prints the HTTP status.
logout() {
  curl -s -o /dev/null -w "%{http_code}" -X DELETE "$host/api/auth" -H "Authorization: Bearer $1"
}

# Places an order for the given JSON items and prints the HTTP status.
order() {
  curl -s -o /dev/null -w "%{http_code}" -X POST "$host/api/order" \
    -H 'Content-Type: application/json' \
    -H "Authorization: Bearer $1" \
    -d "{\"franchiseId\": 1, \"storeId\":1, \"items\":[$2]}"
}

# Prints true if a login produced a token, otherwise false.
loggedIn() {
  if [ -n "$1" ]; then echo true; else echo false; fi
}

veggie='{ "menuId": 1, "description": "Veggie", "price": 0.05 }'

# Request the menu every 3 seconds
while true; do
  status=$(curl -s -o /dev/null -w "%{http_code}" "$host/api/order/menu")
  echo "Requesting menu... $status"
  sleep 3
done &
pids+=($!)

# Attempt an invalid login every 25 seconds
while true; do
  status=$(curl -s -o /dev/null -w "%{http_code}" -X PUT "$host/api/auth" \
    -d '{"email":"unknown@jwt.com", "password":"bad"}' \
    -H 'Content-Type: application/json')
  echo "Logging in with invalid credentials... $status"
  sleep 25
done &
pids+=($!)

# Login as a franchisee and logout two minutes later
while true; do
  token=$(login "f@jwt.com" "franchisee")
  echo "Login franchisee... $(loggedIn "$token")"
  sleep 110
  echo "Logging out franchisee... $(logout "$token")"
  sleep 10
done &
pids+=($!)

# Login as a diner, buy a pizza, and logout
while true; do
  token=$(login "d@jwt.com" "diner")
  echo "Login diner... $(loggedIn "$token")"
  echo "Bought a pizza... $(order "$token" "$veggie")"
  sleep 20
  echo "Logging out diner... $(logout "$token")"
  sleep 30
done &
pids+=($!)

# Login as a diner and order too many pizzas, which causes a 500 error
while true; do
  token=$(login "d@jwt.com" "diner")
  echo "Login hungry diner... $(loggedIn "$token")"

  items=$veggie
  for ((i = 0; i < 21; i++)); do
    items+=", $veggie"
  done

  echo "Bought too many pizzas... $(order "$token" "$items")"
  sleep 5
  echo "Logging out hungry diner... $(logout "$token")"
  sleep 295
done &
pids+=($!)

wait
