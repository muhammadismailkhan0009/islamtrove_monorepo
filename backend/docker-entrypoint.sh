#!/bin/sh
set -eu
review_dir="$ISLAMTROVE_REVIEW_DATA_DIR"
if [ ! -d "$review_dir" ] || [ ! -w "$review_dir" ]; then
  echo "Review directory is not mounted or writable: $review_dir" >&2
  exit 1
fi
# Bootstrap public review data on a new host only. Never overwrite live reviews.
for seed in /app/review-seed/[0-9][0-9][0-9].json /app/review-seed/groupings.json; do
  [ -f "$seed" ] || continue
  filename="$(basename "$seed")"
  if [ ! -e "$review_dir/$filename" ]; then
    cp "$seed" "$review_dir/$filename"
  fi
done
exec "$@"
