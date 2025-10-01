# src/services/plagiarism_detector.py

import ast
import os
import re
import javalang  
from typing import Any, Dict, List, Optional, Sequence, Set, Tuple

# External packages:
#  - datasketch: MinHash + LSH for fast near-duplicate detection on token shingles
#  - scikit-learn: character n-gram TF-IDF (for a recall-oriented candidate set)
from datasketch import MinHash, MinHashLSH
from sklearn.feature_extraction.text import TfidfVectorizer

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

    2) AST Similarity (language-specific, rename-robust):
       - Python: true AST via `ast` -> node-type n-grams (IDs/consts collapsed).
       - Java: `javalang` AST 

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
    # Load code (keep alignment on failures)
    docs: List[str] = []
    for e in file_entries:
        try:
            with open(e["filepath"], "r", encoding="utf-8", errors="ignore") as f:
                docs.append(f.read())
        except Exception:
            docs.append("")

    n = len(file_entries)

    # Resolve language preference: explicit arg > extension heuristic
    lang = (language or "").strip().lower()
    if not lang:
        exts = {os.path.splitext(e.get("filepath", ""))[1].lower() for e in file_entries}
        lang = "java" if ".java" in exts else "python"

    # -------------------------------
    # TOKEN CHANNEL (language-agnostic; rename-sensitive)
    # -------------------------------
    lex_token_lists: List[List[str]] = [simple_lex_tokens(src) for src in docs]
    lex_shingle_sets: List[Set[str]] = [set(make_shingles(toks, token_shingle_size)) for toks in lex_token_lists]

    minhashes_lex: List[MinHash] = []
    for sset in lex_shingle_sets:
        mh = MinHash(num_perm=minhash_perm)
        for sh in sset:
            mh.update(sh.encode("utf-8"))
        minhashes_lex.append(mh)

    lsh_lex = MinHashLSH(threshold=lsh_threshold_token, num_perm=minhash_perm)
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
        ast_sets: List[Set[str]] = [ast_node_ngrams_java(src) for src in docs]
    else:
        ast_sets = [ast_node_ngrams_py(src) for src in docs]

    # -------------------------------
    # AST-BASED CANDIDATEING (rename-robust pull-in)
    # Ensure pairs with high AST overlap are scored even if tokens differ.
    # Use the same report_threshold so we don't inflate recall too much.
    # -------------------------------
    for i in range(n):
        ai = ast_sets[i]
        if not ai:
            continue
        for j in range(i + 1, n):
            bj = ast_sets[j]
            if not bj:
                continue
            if jaccard(ai, bj) >= report_threshold:
                candidates.add((i, j))

    # -------------------------------
    # Score and collect results
    # -------------------------------
    results: List[Dict[str, Any]] = []
    for i, j in sorted(candidates):
        token_sim = jaccard(lex_shingle_sets[i], lex_shingle_sets[j])  # rename-sensitive
        ast_sim = jaccard(ast_sets[i], ast_sets[j])                    # rename-robust
        cos = cos_mat[i][j]                                            # auxiliary

        if max(token_sim, ast_sim, cos) < report_threshold:
            continue

        snip_a, snip_b = best_overlap_snippets(docs[i], docs[j])
        results.append({
            "a": pick(file_entries[i], "user_id", "name", "class_id", "submission_id"),
            "b": pick(file_entries[j], "user_id", "name", "class_id", "submission_id"),
            "similarity_token": float(token_sim),
            "similarity_ast": float(ast_sim),
            "overlap_snippet_a": snip_a,
            "overlap_snippet_b": snip_b,
        })

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


def normalize_for_tfidf(s: str) -> str:
    # Strip common comments and compress whitespace
    s = re.sub(r"/\*.*?\*/", "", s, flags=re.S)  # Java /* ... */
    s = re.sub(r"//.*", "", s)                   # Java //
    s = re.sub(r"#.*", "", s)                    # Python #
    s = re.sub(r'"""(?:.|\n)*?"""', '""', s)     # Python triple-quoted
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
    return [" ".join(tokens[i:i + k]) for i in range(n)]


# -------- LANGUAGE-INDEPENDENT LEXICAL TOKENIZATION --------

def simple_lex_tokens(src: str) -> List[str]:
    """
    Simple regex tokenizer shared by all languages.
    Identifiers are kept AS-IS (rename-sensitive). Literals are normalized.
    """
    # Remove comments (keep spacing approximately)
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)  # Java block comments
    src = re.sub(r"//.*", "", src)                   # Java single-line
    src = re.sub(r"#.*", "", src)                    # Python single-line

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

def best_overlap_snippets(a: str, b: str, context_lines: int = 5) -> Tuple[str, str]:
    """
    Heuristic: find the longest contiguous window of identical lines after
    whitespace compression; return a few raw lines around it from each side.
    """
    a_lines = a.splitlines()
    b_lines = b.splitlines()
    a_norm = [re.sub(r"\s+", " ", ln).strip() for ln in a_lines]
    b_norm = [re.sub(r"\s+", " ", ln).strip() for ln in b_lines]

    best = (0, 0, 0)  # length, ai, bi
    for ai, al in enumerate(a_norm):
        if not al:
            continue
        for bi, bl in enumerate(b_norm):
            if al and al == bl:
                k = 0
                while (
                    ai + k < len(a_norm)
                    and bi + k < len(b_norm)
                    and a_norm[ai + k] == b_norm[bi + k]
                ):
                    k += 1
                if k > best[0]:
                    best = (k, ai, bi)

    k, ai, bi = best
    if k == 0:
        return ("", "")
    a_start = max(0, ai - context_lines)
    a_end = min(len(a_lines), ai + k + context_lines)
    b_start = max(0, bi - context_lines)
    b_end = min(len(b_lines), bi + k + context_lines)
    return ("\n".join(a_lines[a_start:a_end]), "\n".join(b_lines[b_start:b_end]))