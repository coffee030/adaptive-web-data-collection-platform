import json
from hashlib import sha256
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

SCRIPT = """setTimeout(() => {
  const products = JSON.parse(document.getElementById('products').textContent);
  for (const product of products) {
    const item = document.createElement('article');
    for (const [key, value] of Object.entries(product)) {
      const field = document.createElement('span');
      field.className = key;
      field.textContent = value;
      item.append(field);
    }
    document.querySelector('main').append(item);
  }
  if (!document.body.hasAttribute('data-stalled')) document.querySelector('main').id = 'catalog-ready';
}, 60);"""
DIGEST = sha256(SCRIPT.encode()).hexdigest()
PRODUCTS = [
    {
        "sku": "studio-cup",
        "title": "Stoneware cup",
        "price": "78",
        "currency": "HKD",
        "category": "Tableware",
        "availability": "In stock",
    },
    {
        "sku": "studio-bowl",
        "title": "Rice bowl",
        "price": "96",
        "currency": "HKD",
        "category": "Tableware",
    },
    {
        "sku": "studio-plate",
        "title": "Glazed side plate",
        "price": "120",
        "currency": "HKD",
        "category": "Tableware",
        "availability": "In stock",
    },
    {
        "sku": "studio-bottle",
        "title": "Water bottle",
        "price": "165",
        "currency": "HKD",
        "category": "Drinkware",
        "availability": "In stock",
    },
    {
        "sku": "studio-tray",
        "title": "Serving tray",
        "price": "210",
        "currency": "HKD",
        "category": "Serving",
        "availability": "Made to order",
    },
    {
        "sku": "studio-dish",
        "title": "Soy sauce dish",
        "price": "42",
        "currency": "HKD",
        "category": "Tableware",
        "availability": "In stock",
    },
    {
        "sku": "studio-pitcher",
        "title": "Small pitcher",
        "price": "185",
        "currency": "HKD",
        "category": "Serving",
    },
    {
        "sku": "studio-jar",
        "title": "Tea caddy",
        "price": "145",
        "currency": "HKD",
        "category": "Storage",
        "availability": "In stock",
    },
    {
        "sku": "studio-vase",
        "title": "Stem vase",
        "price": "235",
        "currency": "HKD",
        "category": "Home",
        "availability": "Made to order",
    },
    {
        "sku": "studio-spoon",
        "title": "Porcelain spoon",
        "price": "56",
        "currency": "HKD",
        "category": "Tableware",
        "availability": "In stock",
    },
]


def page(path):
    script = SCRIPT
    if path.endswith("/unknown-script"):
        script += "\ndocument.title = 'Changed fixture';"
    stalled = " data-stalled" if path.endswith("/stalled") else ""
    return (
        f"<!doctype html><html><head><title>Controlled pottery catalogue</title></head><body{stalled}>"
        + '<main></main><script type="application/json" id="products">'
        + json.dumps(PRODUCTS)
        + "</script><script>"
        + script
        + "</script></body></html>"
    ).encode()


class Fixture(BaseHTTPRequestHandler):
    def do_GET(self):
        path = urlsplit(self.path).path
        status = 200
        headers = {}
        if path == "/robots.txt":
            body = b"User-agent: *\nDisallow: /catalog/robots-denied\n"
            kind = "text/plain"
        elif path.startswith("/catalog/"):
            body, kind = page(path), "text/html; charset=utf-8"
            if path.endswith("/held"):
                status = 403
            if path.endswith("/publisher-policy"):
                headers["Content-Security-Policy"] = "script-src 'none'"
        else:
            status, body, kind = 404, b"", "text/plain"
        self.send_response(status)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(body)))
        for key, val in headers.items():
            self.send_header(key, val)
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    import argparse

    cli = argparse.ArgumentParser()
    cli.add_argument("port", type=int)
    ThreadingHTTPServer(("127.0.0.1", cli.parse_args().port), Fixture).serve_forever()
