"""Structured logging configuration for the job scraping system."""

import os
import structlog
from structlog.typing import EventDict, WrappedLogger


def setup_logger() -> None:
    """
    Configure structlog for the scraping system.

    - Development: Console output with colors
    - Production: JSON output for queryability
    - Automatic context binding (company, scraper phase)
    """
    log_level = os.getenv('LOG_LEVEL', 'INFO').upper()

    # Determine output format based on environment
    is_production = log_level == 'INFO' or os.getenv('ENV', 'development') == 'production'

    processors = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
    ]

    if is_production:
        # JSON output for production (queryable, structured)
        processors.append(structlog.processors.JSONRenderer())
    else:
        # Console output for development (human-readable)
        processors.extend([
            structlog.processors.ExceptionPrettyPrinter(),
            structlog.dev.ConsoleRenderer(colors=True)
        ])

    structlog.configure(
        processors=processors,
        wrapper_class=structlog.make_filtering_bound_logger(
            getattr(structlog.stdlib.logging, log_level, structlog.stdlib.logging.INFO)
        ),
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )


def get_logger() -> WrappedLogger:
    """
    Get a logger instance for the current module.

    Returns:
        Configured structlog logger with context binding support

    Example:
        >>> log = get_logger()
        >>> log.info("scrape_start", company="Baker Hughes", jobs_found=42)
    """
    return structlog.get_logger()
