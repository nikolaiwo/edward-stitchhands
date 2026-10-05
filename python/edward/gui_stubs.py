import sys, types, importlib.abc, importlib.machinery

class _Dummy:
    def __init__(self, *a, **k): pass
    def __call__(self, *a, **k): return _Dummy()
    def __getattr__(self, n): return _Dummy()
    def __or__(self, o): return 0
    __ror__ = __or__
    def __int__(self): return 0
    def __bool__(self): return False
    def __iter__(self): return iter(())

class _StubModule(types.ModuleType):
    def __getattr__(self, n):
        if n.startswith("__"): raise AttributeError(n)
        c = type(n, (_Dummy,), {})
        setattr(self, n, c)
        return c

class _Finder(importlib.abc.MetaPathFinder, importlib.abc.Loader):
    PREFIXES = ("wx", "flask", "flask_cors", "werkzeug", "webbrowser")
    def find_spec(self, name, path, target=None):
        if name.split(".")[0] in self.PREFIXES:
            return importlib.machinery.ModuleSpec(name, self, is_package=True)
    def create_module(self, spec):
        m = _StubModule(spec.name); m.__path__ = []; return m
    def exec_module(self, m): pass

sys.meta_path.insert(0, _Finder())
