import { loadPyodide } from "pyodide";
const t0 = Date.now();
const py = await loadPyodide();
py.FS.mkdirTree("/inkstitch");
py.FS.mount(py.FS.filesystems.NODEFS, { root: "../inkstitch" }, "/inkstitch");
py.FS.mkdirTree("/work");
py.FS.mount(py.FS.filesystems.NODEFS, { root: "." }, "/work");
await py.loadPackage(["micropip","numpy","shapely","networkx","lxml","jinja2"], {messageCallback: ()=>{}});
const mp = py.pyimport("micropip");
await mp.install(["tinycss2","cssselect","pyparsing","packaging"]);
py.FS.mkdirTree("/inkexsrc"); py.FS.mount(py.FS.filesystems.NODEFS, { root: "../inkex-src" }, "/inkexsrc");
for (const p of ["pystitch","platformdirs","colormath2","fonttools","trimesh","diskcache","tomli"]) {
  try { await mp.install(p); console.log("ok", p); } catch (e) { console.log("FAIL", p, String(e).slice(-300)); }
}
console.log("load secs", (Date.now()-t0)/1000);
await py.runPythonAsync(`
import sys, os, types
sys.path.insert(0, "/inkstitch"); sys.path.insert(1, "/inkexsrc")
os.environ["INKSTITCH_OFFLINE_SCRIPT"]="1"
exec(open("/work/wxstub.py").read())
fmt = "${process.argv[2] || "dst"}"
sys.argv = ["inkstitch", "--format="+fmt, "/work/test.svg"]
import io
buf = io.BytesIO()
class FakeOut:
    buffer = buf
    def write(self, s): pass
    def flush(self): pass
real = sys.stdout
from lib.extensions.output import Output
sys.stdout = FakeOut()
try:
    Output().run()
except SystemExit:
    pass
finally:
    sys.stdout = real
open("/work/out."+fmt, "wb").write(buf.getvalue())
print("bytes", len(buf.getvalue()))
`);
console.log("total secs", (Date.now()-t0)/1000);
