<?php

const MAX_REQUEST_BYTES = 16384;
const MAX_TIP_LENGTH = 5000;

function send_json($status, $payload)
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

function open_tip_store()
{
    $directory = dirname(__DIR__) . '/instance';
    if (!is_dir($directory) && !mkdir($directory, 0750, true) && !is_dir($directory)) {
        send_json(500, array('error' => 'Could not create shared tip storage.'));
    }

    $path = $directory . '/shared_tips.json';
    $handle = fopen($path, 'c+');
    if ($handle === false) {
        send_json(500, array('error' => 'Could not open shared tip storage.'));
    }

    if (!flock($handle, LOCK_EX)) {
        fclose($handle);
        send_json(500, array('error' => 'Could not lock shared tip storage.'));
    }

    return $handle;
}

function read_tips($handle)
{
    rewind($handle);
    $contents = stream_get_contents($handle);
    if ($contents === false || $contents === '') {
        return array('ENG' => array(), 'JPN' => array());
    }

    $tips = json_decode($contents, true);
    if (!is_array($tips)) {
        send_json(500, array('error' => 'Shared tip storage contains invalid JSON.'));
    }

    foreach (array('ENG', 'JPN') as $language) {
        if (!isset($tips[$language]) || !is_array($tips[$language])) {
            $tips[$language] = array();
        }
    }

    return $tips;
}

function write_tips($handle, $tips)
{
    $contents = json_encode($tips, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    if ($contents === false) {
        send_json(500, array('error' => 'Could not encode shared tips.'));
    }

    rewind($handle);
    if (!ftruncate($handle, 0) || fwrite($handle, $contents) === false || !fflush($handle)) {
        send_json(500, array('error' => 'Could not write shared tip storage.'));
    }
}

$method = isset($_SERVER['REQUEST_METHOD']) ? $_SERVER['REQUEST_METHOD'] : 'GET';
if ($method === 'GET') {
    $handle = open_tip_store();
    $tips = read_tips($handle);
    flock($handle, LOCK_UN);
    fclose($handle);
    send_json(200, array('tips' => $tips));
}

if ($method !== 'PUT') {
    header('Allow: GET, PUT');
    send_json(405, array('error' => 'Only GET and PUT are supported.'));
}

$contentLength = isset($_SERVER['CONTENT_LENGTH']) ? (int) $_SERVER['CONTENT_LENGTH'] : 0;
if ($contentLength < 1 || $contentLength > MAX_REQUEST_BYTES) {
    send_json(400, array('error' => 'Request body size is invalid.'));
}

$body = file_get_contents('php://input');
$payload = json_decode($body, true);
if (!is_array($payload)) {
    send_json(400, array('error' => 'Request body must be valid JSON.'));
}

$language = isset($payload['language']) ? $payload['language'] : '';
$itemCode = isset($payload['itemCode']) ? $payload['itemCode'] : '';
$text = isset($payload['text']) ? $payload['text'] : null;
if (!in_array($language, array('ENG', 'JPN'), true)) {
    send_json(400, array('error' => 'Language must be ENG or JPN.'));
}
if (!is_string($itemCode) || !preg_match('/^(?:[1-9]|10)\.[1-9]$/', $itemCode)) {
    send_json(400, array('error' => 'Item code is invalid.'));
}
if (!is_string($text)) {
    send_json(400, array('error' => 'Tip text must be a string.'));
}
if (strlen($text) > MAX_TIP_LENGTH) {
    send_json(400, array('error' => 'Tip text is too long.'));
}

$handle = open_tip_store();
$tips = read_tips($handle);
$text = trim($text);
if ($text === '') {
    unset($tips[$language][$itemCode]);
} else {
    $tips[$language][$itemCode] = $text;
}
write_tips($handle, $tips);
flock($handle, LOCK_UN);
fclose($handle);

send_json(200, array('ok' => true));
