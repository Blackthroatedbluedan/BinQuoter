Training CSV inputs (commit these so clones can retrain)

bin_hours_2025_parsed.csv
  Rows from the parsed "bin hours" workbook (New/Old/Extension mix allowed;
  training uses New-build only). May include optional anchor rows for rare sizes.

historical_training_filled.csv
  Historical jobs with columns including Drive_hrs_TO_FILL, Guys_TO_FILL, and the
  same bin fields as the merged output. Renamed from manhour_historical_training_TEMPLATE_filled.csv.

After editing either file, run from manhour-data/:
  npm run merge-training
  npm run train
