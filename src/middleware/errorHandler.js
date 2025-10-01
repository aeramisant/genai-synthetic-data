// Centralized error handling & response shape
export function errorHandler(err, _req, res, _next) {
  const status = err.status || 500;
  res.status(status).json({
    error: {
      message: err.message || 'Internal Server Error',
      code: err.code || 'INTERNAL_ERROR',
    },
  });
}

export function notFound(_req, res) {
  res.status(404).json({ error: { message: 'Not Found', code: 'NOT_FOUND' } });
}
