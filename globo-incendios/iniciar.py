"""Servidor local para la aplicación. Ejecutar: python iniciar.py"""
import argparse
import socket
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import URLError
from urllib.request import urlopen
import webbrowser


class Manejador(SimpleHTTPRequestHandler):
    # Con HTTP/1.0 cada respuesta cierra la conexión, y en Windows eso cortaba las
    # descargas grandes (5 de 15 correctas, frente a 15 de 15 manteniéndola abierta).
    protocol_version = "HTTP/1.1"


class ServidorLocal(ThreadingHTTPServer):
    allow_reuse_address = False
    request_queue_size = 64

    def server_bind(self):
        # Windows otherwise permits multiple development servers on one port.
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--puerto", type=int, default=8000)
    parser.add_argument("--sin-navegador", action="store_true")
    parser.add_argument("--tierra", action="store_true", help="Abrir la primera escena de la Tierra 3D")
    args = parser.parse_args()
    carpeta = Path(__file__).resolve().parent
    handler = partial(Manejador, directory=str(carpeta))
    try:
        servidor = ServidorLocal(("127.0.0.1", args.puerto), handler)
    except OSError as error:
        if args.tierra:
            url_existente = f"http://127.0.0.1:{args.puerto}/tierra/"
            try:
                with urlopen(url_existente, timeout=2) as respuesta:
                    pagina = respuesta.read(4096).decode("utf-8")
                    es_tierra = ('name="application-name" content="Fire Orbit"' in pagina
                                 or 'name="application-name" content="Fire Sat"' in pagina
                                 or 'name="application-name" content="Atlas del fuego"' in pagina
                                 or "<title>La Tierra · Atlas</title>" in pagina)
                if es_tierra:
                    print(f"La Tierra ya está disponible: {url_existente}", flush=True)
                    if not args.sin_navegador:
                        webbrowser.open(url_existente)
                    return
            except (OSError, URLError, UnicodeError):
                pass
        print(f"No se pudo abrir el puerto {args.puerto}: {error}")
        print("Prueba con: python iniciar.py --puerto 8001")
        raise SystemExit(1)
    base = f"http://127.0.0.1:{args.puerto}"
    url = f"{base}/tierra/" if args.tierra else base
    print(f"Aplicación: {url}\nDetener: Ctrl+C", flush=True)
    if not args.sin_navegador:
        webbrowser.open(url)
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        print("\nServidor detenido.")
    finally:
        servidor.server_close()


if __name__ == "__main__":
    main()
