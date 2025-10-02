export function initializeLangfuse() {
  // Placeholder: integrate Langfuse or other monitoring/telemetry here
  if (process.env.GEMINI_API_KEY) {
    console.log('Langfuse initialization stub (API key detected)');
  } else {
    console.log('Langfuse not configured (no API key)');
  }
}
