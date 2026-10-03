<?php
// StartupGuard - configuration
//
// Settings come from environment variables so deployments can change them
// without editing code. The fallbacks are local development defaults.
//
//   SG_DB_PATH         Path to the SQLite database file.
//                      Default: database/startupguard.sqlite (build it with
//                      `php database/build.php`).
//
// AI analysis (api/analyze.php, Claude via the Anthropic Messages API):
//
//   ANTHROPIC_API_KEY  API key. Required for analysis; never sent to the browser.
//                      Set it in the environment of the PHP process, never in
//                      this file or anywhere under the web root.
//   SG_AI_MODEL        Model id. Default: claude-opus-5-5
//   SG_AI_EFFORT       low | medium | high | xhigh | max. Default: medium
//   SG_AI_MAX_TOKENS   Output token limit. Default: 16000
//   SG_AI_TIMEOUT      Seconds to wait for the AI. Default: 120
//   SG_AI_BASE_URL     API base URL. Default: https://api.anthropic.com
//                      (change it only for a proxy or a local test server)
//
// Easiest: put these values in api/ai-settings.php instead of the environment.
// Gemini: SG_AI_PROVIDER=gemini + GEMINI_API_KEY (default model gemini-2.5-flash).
//
// Ollama instead of Claude (SG_AI_PROVIDER=ollama, uses Ollama's /api/chat):
//
//   SG_AI_PROVIDER     anthropic (default) | ollama
//   OLLAMA_API_KEY     Only for Ollama's cloud (https://ollama.com). A local
//                      Ollama needs no key.
//   SG_AI_MODEL        Required in practice, e.g. llama3.1 or gpt-oss:120b
//   SG_AI_BASE_URL     Default http://localhost:11434 (local Ollama);
//                      https://ollama.com for Ollama's cloud.

declare(strict_types=1);

if (!function_exists('sgEnv')) {
    /** Read an environment variable, or return the fallback when it is not set. */
    function sgEnv(string $name, string $default): string
    {
        // api/ai-settings.php (if present) wins over the environment.
        static $file = null;
        if ($file === null) {
            $path = __DIR__ . '/ai-settings.php';
            $file = is_file($path) ? (array) (require $path) : [];
        }
        if (isset($file[$name]) && is_string($file[$name]) && trim($file[$name]) !== '') {
            return trim($file[$name]);
        }
        $value = getenv($name);
        return $value === false || $value === '' ? $default : $value;
    }
}

$sgProvider = strtolower(sgEnv('SG_AI_PROVIDER', 'anthropic'));
if (!in_array($sgProvider, ['anthropic', 'ollama', 'gemini'], true)) {
    $sgProvider = 'anthropic';
}
$sgDefaults = [
    'anthropic' => ['key' => 'ANTHROPIC_API_KEY', 'model' => 'claude-opus-5-5', 'url' => 'https://api.anthropic.com'],
    'ollama'    => ['key' => 'OLLAMA_API_KEY', 'model' => 'llama3.1', 'url' => 'http://localhost:11434'],
    'gemini'    => ['key' => 'GEMINI_API_KEY', 'model' => 'gemini-2.5-flash', 'url' => 'https://generativelanguage.googleapis.com'],
][$sgProvider];

return [
    'db' => [
        'path' => sgEnv('SG_DB_PATH', dirname(__DIR__) . '/database/startupguard.sqlite'),
    ],
    'ai' => [
        'provider'   => $sgProvider,
        'api_key'    => sgEnv($sgDefaults['key'], ''),
        'model'      => sgEnv('SG_AI_MODEL', $sgDefaults['model']),
        'effort'     => sgEnv('SG_AI_EFFORT', 'medium'),
        'max_tokens' => (int) sgEnv('SG_AI_MAX_TOKENS', '16000'),
        'timeout'    => (int) sgEnv('SG_AI_TIMEOUT', '120'),
        'base_url'   => rtrim(sgEnv('SG_AI_BASE_URL', $sgDefaults['url']), '/'),
    ],
];
