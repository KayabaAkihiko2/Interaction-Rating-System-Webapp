<?php

const MAX_REQUEST_BYTES = 1048576;
const MAX_CSV_BYTES = 262144;
const MAX_RATER_NAME_BYTES = 120;
const MAX_VIDEO_ID_BYTES = 120;

function send_json($status, $payload)
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

function open_rating_store()
{
    $directory = dirname(__DIR__) . '/instance';
    if (!is_dir($directory) && !mkdir($directory, 0750, true) && !is_dir($directory)) {
        send_json(500, array('error' => 'Could not create shared rating storage.'));
    }

    $handle = fopen($directory . '/uploaded_ratings.json', 'c+');
    if ($handle === false) {
        send_json(500, array('error' => 'Could not open shared rating storage.'));
    }
    if (!flock($handle, LOCK_EX)) {
        fclose($handle);
        send_json(500, array('error' => 'Could not lock shared rating storage.'));
    }

    return $handle;
}

function read_rating_store($handle)
{
    rewind($handle);
    $contents = stream_get_contents($handle);
    if ($contents === false || $contents === '') {
        return array();
    }

    $ratings = json_decode($contents, true);
    if (!is_array($ratings)) {
        send_json(500, array('error' => 'Shared rating storage contains invalid JSON.'));
    }
    return $ratings;
}

function write_rating_store($handle, $ratings)
{
    $contents = json_encode($ratings, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    if ($contents === false) {
        send_json(500, array('error' => 'Could not encode shared ratings.'));
    }

    rewind($handle);
    if (!ftruncate($handle, 0) || fwrite($handle, $contents) === false || !fflush($handle)) {
        send_json(500, array('error' => 'Could not write shared rating storage.'));
    }
}

function parse_uploaded_csv($csv)
{
    $stream = fopen('php://temp', 'r+');
    if ($stream === false) {
        send_json(500, array('error' => 'Could not parse uploaded CSV.'));
    }
    fwrite($stream, $csv);
    rewind($stream);

    $headers = fgetcsv($stream);
    if (!is_array($headers)) {
        fclose($stream);
        send_json(400, array('error' => 'CSV must contain a header row.'));
    }
    $headers[0] = preg_replace('/^\xEF\xBB\xBF/', '', $headers[0]);
    $headerIndexes = array();
    foreach ($headers as $index => $header) {
        $headerIndexes[strtolower(trim($header))] = $index;
    }
    foreach (array('category', '#', 'rating') as $required) {
        if (!array_key_exists($required, $headerIndexes)) {
            fclose($stream);
            send_json(400, array('error' => 'CSV must contain Category, #, and Rating columns.'));
        }
    }

    $canonicalPath = dirname(__DIR__) . '/IRS_full_ENG.csv';
    $canonical = fopen($canonicalPath, 'r');
    if ($canonical === false) {
        fclose($stream);
        send_json(500, array('error' => 'Could not load the canonical IRS item list.'));
    }
    fgetcsv($canonical);
    $expectedItems = array();
    while (($row = fgetcsv($canonical)) !== false) {
        if (count($row) < 2 || !preg_match('/^\s*(\d{1,2})\./', $row[0], $matches)) {
            continue;
        }
        $expectedItems[(int) $matches[1] . '.' . (int) $row[1]] = true;
    }
    fclose($canonical);

    $itemRatings = array();
    $rowNumber = 1;
    while (($row = fgetcsv($stream)) !== false) {
        $rowNumber++;
        if (count($row) === 1 && trim($row[0]) === '') {
            continue;
        }
        $category = isset($row[$headerIndexes['category']]) ? $row[$headerIndexes['category']] : '';
        $question = isset($row[$headerIndexes['#']]) ? $row[$headerIndexes['#']] : '';
        $rating = isset($row[$headerIndexes['rating']])
            ? strtolower(trim($row[$headerIndexes['rating']]))
            : '';
        if (!preg_match('/^\s*(\d{1,2})\./', $category, $matches)) {
            fclose($stream);
            send_json(400, array('error' => 'CSV row ' . $rowNumber . ' has an invalid category.'));
        }
        if (!preg_match('/^[1-9]$/', trim($question))) {
            fclose($stream);
            send_json(400, array('error' => 'CSV row ' . $rowNumber . ' has an invalid item number.'));
        }
        $itemCode = (int) $matches[1] . '.' . (int) $question;
        if (!isset($expectedItems[$itemCode])) {
            fclose($stream);
            send_json(400, array('error' => 'CSV row ' . $rowNumber . ' is not a recognized IRS item.'));
        }
        if (isset($itemRatings[$itemCode])) {
            fclose($stream);
            send_json(400, array('error' => 'Item ' . $itemCode . ' appears more than once.'));
        }
        if ($rating !== 'yes' && $rating !== 'no') {
            fclose($stream);
            send_json(400, array('error' => 'Item ' . $itemCode . ' needs a Yes/No rating.'));
        }
        $itemRatings[$itemCode] = $rating;
    }
    fclose($stream);

    $missing = array_diff_key($expectedItems, $itemRatings);
    if (count($missing) > 0) {
        send_json(400, array('error' => count($missing) . ' IRS items are missing a valid rating.'));
    }

    return $itemRatings;
}

function valid_label($value, $maxBytes)
{
    return is_string($value)
        && trim($value) !== ''
        && strlen($value) <= $maxBytes
        && !preg_match('/[\x00-\x1F\x7F\/\\\\]/', $value);
}

$method = isset($_SERVER['REQUEST_METHOD']) ? $_SERVER['REQUEST_METHOD'] : 'GET';
if ($method === 'GET') {
    $handle = open_rating_store();
    $store = read_rating_store($handle);
    flock($handle, LOCK_UN);
    fclose($handle);
    $ratings = array();
    foreach ($store as $videoRatings) {
        foreach ($videoRatings as $rating) {
            $ratings[] = $rating;
        }
    }
    send_json(200, array('ratings' => $ratings));
}

if ($method !== 'POST') {
    header('Allow: GET, POST');
    send_json(405, array('error' => 'Only GET and POST are supported.'));
}

$contentLength = isset($_SERVER['CONTENT_LENGTH']) ? (int) $_SERVER['CONTENT_LENGTH'] : 0;
if ($contentLength < 1 || $contentLength > MAX_REQUEST_BYTES) {
    send_json(400, array('error' => 'Upload request size is invalid.'));
}
$payload = json_decode(file_get_contents('php://input'), true);
if (!is_array($payload)) {
    send_json(400, array('error' => 'Upload request must be valid JSON.'));
}

$fileName = isset($payload['fileName']) ? $payload['fileName'] : '';
$csv = isset($payload['csv']) ? $payload['csv'] : null;
if (!is_string($fileName) || !preg_match('/^(.+?)_(.+)\.csv$/i', $fileName, $matches)) {
    send_json(400, array('error' => 'Filename must follow [ID]_[rater name].csv.'));
}
$videoId = trim($matches[1]);
$raterName = trim($matches[2]);
if (!valid_label($videoId, MAX_VIDEO_ID_BYTES)) {
    send_json(400, array('error' => 'Video ID is invalid.'));
}
if (!valid_label($raterName, MAX_RATER_NAME_BYTES)) {
    send_json(400, array('error' => 'Rater name is invalid.'));
}
if (!is_string($csv) || strlen($csv) < 1 || strlen($csv) > MAX_CSV_BYTES) {
    send_json(400, array('error' => 'CSV must be no larger than 256 KB.'));
}
$itemRatings = parse_uploaded_csv($csv);

$handle = open_rating_store();
$store = read_rating_store($handle);
if (!isset($store[$videoId]) || !is_array($store[$videoId])) {
    $store[$videoId] = array();
}
$raterKey = strtolower($raterName);
$record = array(
    'id' => $videoId,
    'rater' => $raterName,
    'fileName' => $fileName,
    'itemRatings' => $itemRatings,
    'itemCount' => count($itemRatings),
    'uploadedAt' => gmdate('c'),
);
$store[$videoId][$raterKey] = $record;
write_rating_store($handle, $store);
flock($handle, LOCK_UN);
fclose($handle);

send_json(200, array('ok' => true, 'rating' => $record));
