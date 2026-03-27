Put your invoice workbook here (2023 + 2024 calendar years).

Suggested filename: Invoices_2023_2024.xlsx

The sheet(s) should include columns the script can recognize, for example:
  - Order #  (or Order, Job #, Job Number — same number as the hours sheet job id)
  - Description (or Item description / line description)

Then from BinData run:

  node attach-invoice-descriptions.js

Or:

  set INVOICES_XLSX=C:\full\path\to\your.xlsx
  node attach-invoice-descriptions.js

This updates output\bin_jobs_clean_2023_2024_combined.csv with:
  invoice_description, invoice_description_count, invoice_match

A backup is saved as bin_jobs_clean_2023_2024_combined.csv.bak
