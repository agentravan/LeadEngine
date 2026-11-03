# Business data sources

## Google Maps scraper request

The upstream `gosom/google-maps-scraper` is a Go-based Google Maps scraping project. It can expose CLI, local UI and REST-style workflows; it is not an official Google API and its use does not make Google Maps data unrestricted or guaranteed free. Automated extraction may conflict with Google Maps terms and can trigger blocks. This project therefore does not bundle or run that scraper against Google Maps, and it does not use proxies or anti-bot bypasses.

Upstream: https://github.com/gosom/google-maps-scraper

## Implemented source: OpenStreetMap

The backend uses Nominatim for geocoding and Overpass for business features. Data is community-maintained, incomplete, and subject to service usage policies and ODbL attribution. Keep searches user-triggered and low volume. Do not run parallel or unbounded crawls. A result limit is a cap, not a coverage guarantee.
