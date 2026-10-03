<?php
// StartupGuard - AI settings
//
// Put your AI provider and key here, then restart `php -S`.
// Values in this file win over environment variables. Leave a value as ''
// to use the environment variable (or the default) instead.
//
// This file prints nothing when opened in a browser, so the key stays on
// the server. Do not commit a real key to a public repository.

return [
    // 'gemini', 'ollama' or 'anthropic'
    'SG_AI_PROVIDER' => 'anthropic',

    // Free key from https://aistudio.google.com/apikey
    'GEMINI_API_KEY' => '',

    // Optional: another model, e.g. 'gemini-2.5-pro'. '' = default.
    'SG_AI_MODEL' => '',

    // Only needed for the other providers.
    'ANTHROPIC_API_KEY' => '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',
    'OLLAMA_API_KEY' => '',
    'SG_AI_BASE_URL' => '',
];
