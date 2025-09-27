# src/services/plagiarism_detector.py
from __future__ import annotations

import ast
import io
import os
import re
import tokenize
from typing import Any, Dict, Iterable, List, Sequence, Set, Tuple

# External packages do the heavy lifting:
#  - datasketch: MinHash + LSH for fast near-duplicate detection on token shingles
#  - scikit-learn: character n-gram TF-IDF
from datasketch import MinHash, MinHashLSH
from sklearn.feature_extraction.text import TfidfVectorizer


def detect_plagiarism(
    file_entries: List[Dict[str, Any]],
    *,
    token_shingle_size: int = 5,
    minhash_perm: int = 128,
    # LSH thresholds
    lsh_threshold: float = 0.80,                 # lexical channel (identifiers preserved)
    lsh_threshold_canon: float = 0.80,           # canonical channel (identifiers collapsed)
    # TF-IDF high-cosine candidate pull-in
    tfidf_candidate_threshold: float = 0.92,
    # Inclusion rule: report pair if ANY signal >= report_threshold
    report_threshold: float = 0.60,
) -> Dict[str, Any]:
    """
    file_entries: list of { user_id, name, class_id, submission_id, filepath }

    Returns:
      {
        'pairs': [
          {
            'a': {...}, 'b': {...},
            'similarity_token': float,  # lexical token-shingle Jaccard
            'similarity_ast': float,    # AST node-gram Jaccard
            'overlap_snippet_a': str,
            'overlap_snippet_b': str,
          }, ...
        ]
      }
    """
    # Load raw code
    docs: List[str] = []
    for e in file_entries:
        try:
            with open(e["filepath"], "r", encoding="utf-8", errors="ignore") as f:
                docs.append(f.read())
        except Exception:
            docs.append("")  # keep alignment even if a file is missing

    n = len(file_entries)

    # -------------------------------
    # Token channels
    # -------------------------------
    # Lexical tokens (identifiers preserved) -> drives "Token Sim"
    lex_token_lists: List[List[str]] = [lex_tokens_py(src) for src in docs]
    lex_shingle_sets: List[Set[str]] = [set(make_shingles(toks, token_shingle_size)) for toks in lex_token_lists]

    # Canonical tokens (identifiers collapsed) -> improves recall for pure-rename cases
    canon_token_lists: List[List[str]] = [canonical_tokens_py(src) for src in docs]
    canon_shingle_sets: List[Set[str]] = [set(make_shingles(toks, token_shingle_size)) for toks in canon_token_lists]

    # -------------------------------
    # LSH over lexical shingles
    # -------------------------------
    minhashes_lex: List[MinHash] = []
    for sset in lex_shingle_sets:
        mh = MinHash(num_perm=minhash_perm)
        for sh in sset:
            mh.update(sh.encode("utf-8"))
        minhashes_lex.append(mh)

    lsh_lex = MinHashLSH(threshold=lsh_threshold, num_perm=minhash_perm)
    for idx, mh in enumerate(minhashes_lex):
        lsh_lex.insert(str(idx), mh)

    # -------------------------------
    # LSH over canonical shingles
    # -------------------------------
    minhashes_canon: List[MinHash] = []
    for sset in canon_shingle_sets:
        mh = MinHash(num_perm=minhash_perm)
        for sh in sset:
            mh.update(sh.encode("utf-8"))
        minhashes_canon.append(mh)

    lsh_canon = MinHashLSH(threshold=lsh_threshold_canon, num_perm=minhash_perm)
    for idx, mh in enumerate(minhashes_canon):
        lsh_canon.insert(str(idx), mh)

    # -------------------------------
    # Candidate union: lexical-LSH ∪ canonical-LSH
    # -------------------------------
    candidates: Set[Tuple[int, int]] = set()
    for i in range(n):
        for j_str in lsh_lex.query(minhashes_lex[i]):
            j = int(j_str)
            if j > i:
                candidates.add((i, j))
        for j_str in lsh_canon.query(minhashes_canon[i]):
            j = int(j_str)
            if j > i:
                candidates.add((i, j))

    # -------------------------------
    # TF-IDF character n-grams
    # -------------------------------
    tfidf = TfidfVectorizer(analyzer="char", ngram_range=(4, 6), min_df=1)
    tfidf_mat = tfidf.fit_transform([normalize_for_tfidf(s) for s in docs])

    cos_mat = (tfidf_mat * tfidf_mat.T).toarray()
    # Tie candidateing to inclusion: allow any pair that could pass report_threshold
    effective_cos_thresh = min(tfidf_candidate_threshold, report_threshold)
    for i in range(n):
        row = cos_mat[i]
        for j in range(i + 1, n):
            if row[j] >= effective_cos_thresh:
                candidates.add((i, j))

    # -------------------------------
    # AST node-gram sets (precompute)
    # -------------------------------
    ast_sets: List[Set[str]] = [ast_node_ngrams(src) for src in docs]

    # -------------------------------
    # Score and collect results
    # -------------------------------
    results: List[Dict[str, Any]] = []
    for i, j in sorted(candidates):
        # Signals
        jac_lex = jaccard(lex_shingle_sets[i], lex_shingle_sets[j])  # displayed as "Token Sim"
        ast_sim = jaccard(ast_sets[i], ast_sets[j])                  # displayed as "AST Sim"
        cos = cos_mat[i][j]                                          # auxiliary

        # Inclusion rule: include if any signal is strong enough
        if max(jac_lex, ast_sim, cos) < report_threshold:
            continue

        # Build a short overlap snippet from raw code
        snip_a, snip_b = best_overlap_snippets(docs[i], docs[j])

        results.append({
            "a": pick(file_entries[i], "user_id", "name", "class_id", "submission_id"),
            "b": pick(file_entries[j], "user_id", "name", "class_id", "submission_id"),
            "similarity_token": float(jac_lex),
            "similarity_ast": float(ast_sim),
            "overlap_snippet_a": snip_a,
            "overlap_snippet_b": snip_b,
        })

    # Sort by strongest signal first, prefer higher AST when ties
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
    # Strip comments and shrink spaces to stabilize n-grams a bit
    s = re.sub(r"#.*", "", s)
    s = re.sub(r'"""(?:.|\n)*?"""', '""', s)
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
    return [" ".join(tokens[i:i + k]) for i in range(0, max(0, len(tokens) - k + 1))]


# -------- Tokenization helpers --------
def lex_tokens_py(src: str) -> List[str]:
    """
    Lexical tokens with identifiers preserved (comments/whitespace dropped).
    This makes Token Sim sensitive to variable/function renames.
    """
    try:
        toks: List[str] = []
        for tok in tokenize.generate_tokens(io.StringIO(src).readline):
            ttype, tstr = tok.type, tok.string
            if ttype in (
                tokenize.COMMENT, tokenize.NL, tokenize.NEWLINE,
                tokenize.INDENT, tokenize.DEDENT, tokenize.ENCODING, tokenize.ENDMARKER
            ):
                continue
            if ttype == tokenize.NAME:
                # keep keywords and identifiers as-is (keywords are still NAME here)
                toks.append(tstr)
                continue
            if ttype == tokenize.NUMBER:
                toks.append("NUMBER")
                continue
            if ttype == tokenize.STRING:
                toks.append("STRING")
                continue
            if ttype == tokenize.OP:
                toks.append(tstr)
                continue
        return toks
    except Exception:
        # Fallback: simple regex tokenization
        return re.findall(r"[A-Za-z_]+|\d+|==|!=|<=|>=|[-+*/%(){}[\],.:;<>=]", src)


# -------- Canonicalization (robust to renames) --------
def canonical_tokens_py(src: str) -> List[str]:
    """
    Produce a structural token stream:
      - Variable/function names -> generic markers (ID/FUNC)
      - Constants -> CONST
      - Node type names to capture structure
    """
    try:
        tree = ast.parse(src)
    except Exception:
        # Fallback: crude tokenization on words if parsing fails
        return re.findall(r"[A-Za-z_]+|\d+|==|!=|<=|>=|[-+*/%(){}[\],.:;<>=]", src)

    tokens: List[str] = []

    class Tok(ast.NodeVisitor):
        def visit_Name(self, node: ast.Name):
            tokens.append("ID")

        def visit_Attribute(self, node: ast.Attribute):
            tokens.append("ATTR")
            self.generic_visit(node)

        def visit_arg(self, node: ast.arg):
            tokens.append("ARG")

        def visit_Constant(self, node: ast.Constant):
            tokens.append("CONST")

        def visit_FunctionDef(self, node: ast.FunctionDef):
            tokens.append("FUNC")
            self.generic_visit(node)

        def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef):
            tokens.append("FUNC")
            self.generic_visit(node)

        def generic_visit(self, node: ast.AST):
            tokens.append(type(node).__name__)
            super().generic_visit(node)

    Tok().visit(tree)
    return tokens


def ast_node_ngrams(src: str, n: int = 3) -> Set[str]:
    """Set of n-grams over AST node type names (IDs/consts collapsed)."""
    try:
        tree = ast.parse(src)
    except Exception:
        return set()

    seq: List[str] = []

    class V(ast.NodeVisitor):
        def visit_Name(self, node: ast.Name):
            seq.append("ID")

        def visit_Constant(self, node: ast.Constant):
            seq.append("CONST")

        def visit_FunctionDef(self, node: ast.FunctionDef):
            # Keep robustness but add a tiny signal of function-name length
            seq.append("FUNC")
            seq.append(f"FN_LEN_{min(8, len(getattr(node, 'name', '')))}")
            self.generic_visit(node)

        def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef):
            seq.append("FUNC")
            seq.append(f"FN_LEN_{min(8, len(getattr(node, 'name', '')))}")
            self.generic_visit(node)

        def generic_visit(self, node: ast.AST):
            seq.append(type(node).__name__)
            super().generic_visit(node)

    V().visit(tree)
    return set(make_shingles(seq, n))


def best_overlap_snippets(a: str, b: str, context_lines: int = 5) -> Tuple[str, str]:
    """
    Cheap heuristic: find the longest common substring window after whitespace
    compression and return a few raw lines around it from each side.
    """
    a_lines = a.splitlines()
    b_lines = b.splitlines()
    a_comp = [re.sub(r"\s+", " ", ln).strip() for ln in a_lines]
    b_comp = [re.sub(r"\s+", " ", ln).strip() for ln in b_lines]

    best = (0, 0, 0)  # length, ai, bi
    # Brute force but bounded (typical classroom sizes are fine)
    for ai, al in enumerate(a_comp):
        if not al:
            continue
        for bi, bl in enumerate(b_comp):
            if al and al == bl:
                # expand downward while equal
                k = 0
                while (
                    ai + k < len(a_comp)
                    and bi + k < len(b_comp)
                    and a_comp[ai + k] == b_comp[bi + k]
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