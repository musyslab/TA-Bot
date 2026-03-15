# src/services/plagiarism_detector.py

import ast
import os
import re
import javalang
from typing import Any, Dict, List, Optional, Sequence, Set, Tuple
from difflib import SequenceMatcher

# External packages:
#  - datasketch: MinHash + LSH for fast near-duplicate detection on token shingles
#  - scikit-learn: character n-gram TF-IDF (for a recall-oriented candidate set)
from datasketch import MinHash, MinHashLSH
from sklearn.feature_extraction.text import TfidfVectorizer

ALLOWED_SOURCE_EXTS: Set[str] = {".py", ".java"}
FILE_MARKER_RE = re.compile(r"^\s*//\s*=====\s*.+?\s*=====\s*$")
IDENT_RE = re.compile(r"^[A-Za-z_][A-Za-z_0-9]*$")

def detect_plagiarism(
    file_entries: List[Dict[str, Any]],
    *,
    language: Optional[str] = None,
    # Token channel (language-independent) parameters
    token_shingle_size: int = 5,
    minhash_perm: int = 128,
    lsh_threshold_token: float = 0.80,
    # TF-IDF high-cosine candidate pull-in
    tfidf_candidate_threshold: float = 0.92,
    # Inclusion rule: report pair if ANY signal >= report_threshold
    report_threshold: float = 0.60,
) -> Dict[str, Any]:
    """
    Two-signal plagiarism detector.

    1) Token Similarity (language-independent, rename-sensitive):
       - Simple regex tokenizer shared by all languages.
       - Identifiers are kept AS-IS; literals are normalized.
       - Shingle tokens and use MinHash LSH to generate candidates.
       - Scoring uses order-sensitive token SequenceMatcher

    2) AST Similarity (language-specific, rename-robust):
       - Python: true AST via `ast` -> node-type n-grams (IDs/consts collapsed).
       - Java: `javalang` AST
       - If parsing fails, falls back to a rename-robust structural token channel (identifiers collapsed to ID).

    Returns:
      {
        'pairs': [
          {
            'a': {...}, 'b': {...},
            'similarity_token': float,
            'similarity_ast': float,
            'overlap_snippet_a': str,
            'overlap_snippet_b': str,
          }, ...
        ]
      }
    """
    # Load code (supports per-submission single file OR directory of files).
    # We keep a combined display string (like the UI) AND per-file parts (for AST parsing).
    docs: List[str] = []
    parts_by_doc: List[List[Tuple[str, str]]] = []
    for e in file_entries:
        text, parts = read_source_entry(str(e.get("filepath", "") or ""))
        docs.append(text)
        parts_by_doc.append(parts)

    n = len(file_entries)

    # Resolve language preference: explicit arg > extension heuristic
    lang = (language or "").strip().lower()
    if not lang:
        exts: Set[str] = set()
        for e in file_entries:
            p = str(e.get("filepath", "") or "")
            try:
                if os.path.isdir(p):
                    for fn in os.listdir(p):
                        _, ext = os.path.splitext(fn)
                        if ext.lower() in ALLOWED_SOURCE_EXTS:
                            exts.add(ext.lower())
                else:
                    _, ext = os.path.splitext(p)
                    if ext:
                        exts.add(ext.lower())
            except Exception:
                continue
        lang = "java" if ".java" in exts else "python"

    # -------------------------------
    # TOKEN CHANNEL (language-agnostic; rename-sensitive)
    # -------------------------------
    lex_token_lists: List[List[str]] = [simple_lex_tokens(src) for src in docs]
    lex_shingle_sets: List[Set[str]] = [set(make_shingles(toks, token_shingle_size)) for toks in lex_token_lists]

    # Rename-robust "structure" channel (no keyword lists; identifiers collapse to ID)
    struct_token_lists: List[List[str]] = [structuralize_tokens(toks) for toks in lex_token_lists]
    struct_shingle_sets: List[Set[str]] = [set(make_shingles(toks, token_shingle_size)) for toks in struct_token_lists]

    minhashes_lex: List[MinHash] = []
    for sset in lex_shingle_sets:
        mh = MinHash(num_perm=minhash_perm)
        for sh in sset:
            mh.update(sh.encode("utf-8"))
        minhashes_lex.append(mh)

    # Candidate generation must be inclusive enough to match what the UI highlights.
    effective_lsh_thresh = min(float(lsh_threshold_token), float(report_threshold))
    lsh_lex = MinHashLSH(threshold=effective_lsh_thresh, num_perm=minhash_perm)
    for idx, mh in enumerate(minhashes_lex):
        lsh_lex.insert(str(idx), mh)

    candidates: Set[Tuple[int, int]] = set()
    for i in range(n):
        for j_str in lsh_lex.query(minhashes_lex[i]):
            j = int(j_str)
            if j > i:
                candidates.add((i, j))

    # -------------------------------
    # TF-IDF character n-grams (cross-language)
    # -------------------------------
    tfidf = TfidfVectorizer(analyzer="char", ngram_range=(4, 6), min_df=1)
    tfidf_mat = tfidf.fit_transform([normalize_for_tfidf(s) for s in docs])
    cos_mat = (tfidf_mat * tfidf_mat.T).toarray()

    # Be inclusive in candidateing: any pair that could clear report_threshold
    effective_cos_thresh = min(tfidf_candidate_threshold, report_threshold)
    for i in range(n):
        row = cos_mat[i]
        for j in range(i + 1, n):
            if row[j] >= effective_cos_thresh:
                candidates.add((i, j))

    # -------------------------------
    # AST CHANNEL (language-specific; rename-robust)
    # -------------------------------
    if lang == "java":
        # Parse each source file separately and union n-grams.
        # This fixes the common failure case where multiple Java files were concatenated.
        ast_sets: List[Set[str]] = [ast_node_ngrams_java_multi(parts) for parts in parts_by_doc]
    else:
        ast_sets = [ast_node_ngrams_py_multi(parts) for parts in parts_by_doc]

    # -------------------------------
    # AST/STRUCT-BASED CANDIDATEING (rename-robust pull-in)
    # Ensure pairs with high AST overlap are scored even if tokens differ.
    # If AST isn't available (parse fails), structural tokens still pull in candidates.
    # -------------------------------
    for i in range(n):
        for j in range(i + 1, n):
            ast_sim_ij = jaccard(ast_sets[i], ast_sets[j])
            struct_sim_ij = jaccard(struct_shingle_sets[i], struct_shingle_sets[j])
            if max(ast_sim_ij, struct_sim_ij) >= report_threshold:
                candidates.add((i, j))

    # -------------------------------
    # Score and collect results
    # -------------------------------
    results: List[Dict[str, Any]] = []
    for i, j in sorted(candidates):
        # Token similarity should match what AdminPlagiarism visually highlights:
        # use sequence-based overlap on lexical tokens (order-sensitive like the viewer),
        # and keep shingle-Jaccard as a stabilizer for very short submissions.
        token_sim_seq = token_sequence_similarity(lex_token_lists[i], lex_token_lists[j])
        token_sim_set = jaccard(lex_shingle_sets[i], lex_shingle_sets[j])
        token_sim = max(token_sim_seq, token_sim_set)  # rename-sensitive

        # AST similarity is rename-robust; if parsing fails, fall back to structural-token shingles.
        ast_sim_raw = jaccard(ast_sets[i], ast_sets[j])
        ast_sim_fallback = jaccard(struct_shingle_sets[i], struct_shingle_sets[j])
        ast_sim = max(ast_sim_raw, ast_sim_fallback)

        cos = float(cos_mat[i][j])  # auxiliary

        if max(token_sim, ast_sim, cos) < report_threshold:
            continue

        snip_a, snip_b = best_overlap_snippets(docs[i], docs[j])
        results.append(
            {
                "a": pick(file_entries[i], "user_id", "name", "class_id", "submission_id"),
                "b": pick(file_entries[j], "user_id", "name", "class_id", "submission_id"),
                "similarity_token": float(token_sim),
                "similarity_ast": float(ast_sim),
                "overlap_snippet_a": snip_a,
                "overlap_snippet_b": snip_b,
            }
        )

    # Sort by strongest signal; prefer higher AST on ties
    results.sort(
        key=lambda r: (
            max(r["similarity_token"], r["similarity_ast"]),
            r["similarity_ast"],
            r["similarity_token"],
        ),
        reverse=True,
    )

    return {"pairs": results}


# ---------------------------
# Helpers
# ---------------------------


def pick(d: Dict[str, Any], *keys: str) -> Dict[str, Any]:
    return {k: d.get(k) for k in keys}


def read_source_entry(path: str) -> Tuple[str, List[Tuple[str, str]]]:
    """
    Returns:
      (combined_text_for_display, [(filename, file_text), ...])
    If `path` is a directory, we read all allowed source files in a stable order.
    The combined text uses the same marker style as the UI so overlap snippets line up.
    """
    parts: List[Tuple[str, str]] = []
    if not path:
        return ("", parts)

    try:
        if os.path.isdir(path):
            names = sorted(os.listdir(path), key=lambda n: (n != "Main.java", n.lower()))
            for name in names:
                full = os.path.join(path, name)
                if not os.path.isfile(full):
                    continue
                _, ext = os.path.splitext(name)
                if ext.lower() not in ALLOWED_SOURCE_EXTS:
                    continue
                try:
                    with open(full, "r", encoding="utf-8", errors="ignore") as f:
                        txt = f.read()
                    parts.append((name, txt))
                except Exception:
                    continue
        else:
            base = os.path.basename(path)
            with open(path, "r", encoding="utf-8", errors="ignore") as f:
                parts.append((base, f.read()))
    except Exception:
        return ("", [])

    # UI-style combined string
    combined_chunks: List[str] = []
    for name, txt in parts:
        combined_chunks.append(f"// ===== {name} =====\n{txt}")
    return ("\n\n".join(combined_chunks), parts)


def token_sequence_similarity(a: Sequence[str], b: Sequence[str]) -> float:
    """
    Order-sensitive similarity aligned with the UI's diff highlighting.
    Uses difflib.SequenceMatcher ratio on lexical token sequences.
    """
    if not a or not b:
        return 0.0
    # Avoid pathological quadratic behavior on extremely large submissions
    max_len = 20000
    aa = list(a[:max_len])
    bb = list(b[:max_len])
    return SequenceMatcher(a=aa, b=bb, autojunk=False).ratio()


def structuralize_tokens(tokens: Sequence[str]) -> List[str]:
    """
    Rename-robust token stream:
      - STRING/NUMBER kept
      - any identifier-like token collapses to ID (no keyword lists)
      - operators/punctuation kept
    """
    out: List[str] = []
    for t in tokens:
        if t in ("STRING", "NUMBER"):
            out.append(t)
        elif IDENT_RE.match(t or ""):
            out.append("ID")
        else:
            out.append(t)
    return out


def ast_node_ngrams_py_multi(parts: List[Tuple[str, str]], n: int = 3) -> Set[str]:
    out: Set[str] = set()
    for name, src in (parts or []):
        if (name or "").lower().endswith(".py") or not name:
            out |= ast_node_ngrams_py(src, n=n)
    return out


def ast_node_ngrams_java_multi(parts: List[Tuple[str, str]], n: int = 3) -> Set[str]:
    out: Set[str] = set()
    for name, src in (parts or []):
        if (name or "").lower().endswith(".java") or not name:
            out |= ast_node_ngrams_java(src, n=n)
    return out


def normalize_for_tfidf(s: str) -> str:
    # Strip common comments and compress whitespace
    s = re.sub(r"/\*.*?\*/", "", s, flags=re.S)  # Java /* ... */
    s = re.sub(r"//.*", "", s)  # Java //
    s = re.sub(r"#.*", "", s)  # Python #
    s = re.sub(r'"""(?:.|\n)*?"""', '""', s)  # Python triple-quoted
    s = re.sub(r"'''(?:.|\n)*?'''", "''", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def jaccard(a: Set[str], b: Set[str]) -> float:
    if not a and not b:
        return 0.0
    if not a or not b:
        return 0.0
    inter = len(a & b)
    union = len(a | b)
    return inter / union if union else 0.0


def make_shingles(tokens: Sequence[str], k: int) -> List[str]:
    if k <= 1:
        return list(tokens)
    n = max(0, len(tokens) - k + 1)
    return [" ".join(tokens[i : i + k]) for i in range(n)]


# -------- LANGUAGE-INDEPENDENT LEXICAL TOKENIZATION --------


def simple_lex_tokens(src: str) -> List[str]:
    """
    Simple regex tokenizer shared by all languages.
    Identifiers are kept AS-IS (rename-sensitive). Literals are normalized.
    """
    # Remove comments (keep spacing approximately)
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)  # Java block comments
    src = re.sub(r"//.*", "", src)  # Java single-line
    src = re.sub(r"#.*", "", src)  # Python single-line

    # Normalize string and number literals
    src = re.sub(r'\"(?:\\.|[^"])*\"|\'(?:\\.|[^\'])*\'', "STRING", src)
    src = re.sub(r"\b\d+(?:\.\d+)?\b", "NUMBER", src)

    # Split into identifiers/operators/punctuation
    pattern = r"[A-Za-z_][A-Za-z_0-9]*|==|!=|<=|>=|&&|\|\||[-+*/%(){}\[\],.;:<>]"
    return re.findall(pattern, src)


# -------- PYTHON AST N-GRAMS (rename-robust) --------


def ast_node_ngrams_py(src: str, n: int = 3) -> Set[str]:
    """
    Python AST -> sequence of node type names (IDs/consts collapsed),
    then n-gram shingles. Robust to identifier renaming.
    """
    try:
        tree = ast.parse(src)
    except Exception:
        return set()

    seq: List[str] = []

    class V(ast.NodeVisitor):
        def visit_Name(self, node: ast.Name) -> None:
            seq.append("ID")

        def visit_Attribute(self, node: ast.Attribute) -> None:
            seq.append("ATTR")
            self.generic_visit(node)

        def visit_arg(self, node: ast.arg) -> None:
            seq.append("ARG")

        def visit_Constant(self, node: ast.Constant) -> None:
            seq.append("CONST")

        def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
            seq.append("FUNC")
            # tiny structural hints
            seq.append(f"FN_LEN_{min(8, len(getattr(node, 'name', '') or ''))}")
            arity = len(getattr(node, "args", None).args) if getattr(node, "args", None) else 0
            seq.append(f"ARGS_{min(8, arity)}")
            self.generic_visit(node)

        def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
            seq.append("FUNC")
            seq.append(f"FN_LEN_{min(8, len(getattr(node, 'name', '') or ''))}")
            arity = len(getattr(node, "args", None).args) if getattr(node, "args", None) else 0
            seq.append(f"ARGS_{min(8, arity)}")
            self.generic_visit(node)

        def visit_ClassDef(self, node: ast.ClassDef) -> None:
            seq.append("CLASS")
            seq.append(f"CN_LEN_{min(8, len(getattr(node, 'name', '') or ''))}")
            self.generic_visit(node)

        def generic_visit(self, node: ast.AST) -> None:
            seq.append(type(node).__name__)
            super().generic_visit(node)

    V().visit(tree)
    return set(make_shingles(seq, n))


# -------- JAVA AST N-GRAMS --------


def ast_node_ngrams_java(src: str, n: int = 3) -> Set[str]:
    """
    Java AST -> node-type sequence via `javalang`.
    """
    seq: List[str] = []

    def walk(node: Any) -> None:
        if isinstance(node, javalang.tree.Node):
            tname = type(node).__name__
            seq.append(tname)
            # add hints for methods
            if isinstance(node, javalang.tree.MethodDeclaration):
                name = getattr(node, "name", "") or ""
                params = getattr(node, "parameters", []) or []
                seq.append(f"FN_LEN_{min(8, len(name))}")
                seq.append(f"ARGS_{min(8, len(params))}")
            for attr in node.attrs:
                val = getattr(node, attr, None)
                if isinstance(val, list):
                    for v in val:
                        walk(v)
                else:
                    walk(val)
        # primitives/None ignored

    # Parse Java source to a CompilationUnit; fail closed if it doesn't parse
    try:
        tree = javalang.parse.parse(src)
    except Exception:
        return set()
    walk(tree)
    return set(make_shingles(seq, n))


# -------- Overlap snippet (teacher convenience) --------


def best_overlap_snippets(a: str, b: str, context_lines: int = 5, min_match_chars: int = 160) -> Tuple[str, str]:
    """
    Find a *contiguous* overlapping region that corresponds to what the UI highlights.
    Uses SequenceMatcher on whitespace-normalized lines (order-sensitive).

    Important: if the best overlap is too small, return empty snippets so the UI
    doesn't filter the pair out due to short overlap snippets.
    """
    a_lines = (a or "").replace("\r\n", "\n").split("\n")
    b_lines = (b or "").replace("\r\n", "\n").split("\n")

    def norm_line(ln: str) -> str:
        if FILE_MARKER_RE.match(ln or ""):
            return ""
        return re.sub(r"\s+", " ", ln).strip()

    a_norm = [norm_line(ln) for ln in a_lines]
    b_norm = [norm_line(ln) for ln in b_lines]

    sm = SequenceMatcher(a=a_norm, b=b_norm, autojunk=False)
    m = sm.find_longest_match(0, len(a_norm), 0, len(b_norm))
    if not m or m.size <= 0:
        return ("", "")

    match_chars = 0
    for k in range(m.size):
        match_chars += len(a_norm[m.a + k] or "")
    if match_chars < int(min_match_chars):
        return ("", "")

    a_start = max(0, m.a - context_lines)
    a_end = min(len(a_lines), m.a + m.size + context_lines)
    b_start = max(0, m.b - context_lines)
    b_end = min(len(b_lines), m.b + m.size + context_lines)
    return ("\n".join(a_lines[a_start:a_end]), "\n".join(b_lines[b_start:b_end]))