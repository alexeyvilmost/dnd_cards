# Script to fix dump encoding
# Problem: UTF-8 data was saved as Windows-1251

$inputFile = "dump_20251212_083829.sql"
$outputFile = "dump_fixed_utf8.sql"

Write-Host "Reading file..."
$bytes = [System.IO.File]::ReadAllBytes($inputFile)

# Try to interpret as Windows-1251 and convert to UTF-8
Write-Host "Converting from Windows-1251 to UTF-8..."
$windows1251 = [System.Text.Encoding]::GetEncoding(1251)
$utf8 = [System.Text.Encoding]::UTF8

# Read as Windows-1251 and re-encode to UTF-8
$text = $windows1251.GetString($bytes)
$utf8Bytes = $utf8.GetBytes($text)

Write-Host "Saving fixed file..."
[System.IO.File]::WriteAllBytes($outputFile, $utf8Bytes)

Write-Host "Done! Fixed file: $outputFile"

