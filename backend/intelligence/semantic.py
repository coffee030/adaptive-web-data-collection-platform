"""Pinned Granite inference and a Unicode character TF-IDF fallback."""

import logging
import unicodedata
from collections import Counter
from functools import lru_cache
from hashlib import file_digest, sha256
from math import log, sqrt
from pathlib import Path
from threading import Lock

REPOSITORY = "ibm-granite/granite-embedding-97m-multilingual-r2"
REVISION = "835ad14087e140460703cf0fae09f97d469d65c2"
WEIGHTS = "onnx/model_quint8_avx2.onnx"
TOKENIZER = "tokenizer.json"
ARTIFACTS = {
    WEIGHTS: (
        98_247_878,
        "a6022dd8220ea6f6595562a1328ee216f4a94faa55362f2f4747c80f1e78772e",
    ),
    TOKENIZER: (
        25_301_672,
        "4f2842d568e2724370aec203652a42ac783c7937f8347a1a2cc7506d71f1582f",
    ),
}
INDEX_VERSION = f"granite-97m-r2-int8:{REVISION}:cls:256:nfkc1"
LOGGER = logging.getLogger(__name__)
MODEL_LOCK = Lock()


def normalized(text: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", text).casefold().split())


def content_key(text: str) -> str:
    return sha256(normalized(text).encode()).hexdigest()


def character_grams(text: str) -> dict[str, int]:
    text = normalized(text)[:768]
    return dict(
        Counter(
            text[offset : offset + size]
            for size in (2, 3, 4)
            for offset in range(len(text) - size + 1)
        )
    )


def tfidf_scores(query: str, documents: dict[str, dict[str, int]]) -> dict[str, float]:
    frequencies = Counter(gram for document in documents.values() for gram in document)
    weights = {
        gram: 1 + log((1 + len(documents)) / (1 + count))
        for gram, count in frequencies.items()
    }
    query_terms = {
        gram: (1 + log(count)) * weights[gram]
        for gram, count in character_grams(query).items()
        if gram in weights
    }
    query_norm = sqrt(sum(value**2 for value in query_terms.values()))
    if not query_norm:
        return dict.fromkeys(documents, 0.0)
    result = {}
    for key, doc in documents.items():
        vector = {gram: (1 + log(count)) * weights[gram] for gram, count in doc.items()}
        norm = sqrt(sum(value**2 for value in vector.values()))
        dot = sum(query_terms.get(gram, 0) * value for gram, value in vector.items())
        result[key] = min(1.0, dot / (query_norm * norm)) if norm else 0.0
    return result


def verified(path: Path, name: str) -> bool:
    size, digest = ARTIFACTS[name]
    if not path.is_file() or path.stat().st_size != size:
        return False
    with path.open("rb") as stream:
        return file_digest(stream, "sha256").hexdigest() == digest


class Granite:
    def __init__(self, directory: Path):
        import numpy as np
        import onnxruntime as ort
        from tokenizers import Tokenizer

        if not all(verified(directory / name, name) for name in ARTIFACTS):
            raise ValueError("Granite artifacts failed verification")
        options = ort.SessionOptions()
        options.intra_op_num_threads = options.inter_op_num_threads = 1
        self.model = ort.InferenceSession(
            str(directory / WEIGHTS),
            sess_options=options,
            providers=["CPUExecutionProvider"],
        )
        self.inputs = {item.name for item in self.model.get_inputs()}
        self.output = self.model.get_outputs()[0].name
        self.tokenizer = Tokenizer.from_file(str(directory / TOKENIZER))
        self.tokenizer.enable_truncation(max_length=256)
        if self.tokenizer.padding is None:
            self.tokenizer.enable_padding(
                pad_token="<|endoftext|>",
                pad_id=self.tokenizer.token_to_id("<|endoftext|>"),
            )
        self.np = np
        self.lock = Lock()

    def encode(self, texts: list[str]) -> list[list[float]]:
        np = self.np
        result = []
        with self.lock:
            for offset in range(0, len(texts), 8):
                batch = self.tokenizer.encode_batch(
                    [normalized(text) for text in texts[offset : offset + 8]]
                )
                arrays = {
                    "input_ids": np.asarray([row.ids for row in batch], dtype=np.int64),
                    "attention_mask": np.asarray(
                        [row.attention_mask for row in batch], dtype=np.int64
                    ),
                    "token_type_ids": np.asarray(
                        [row.type_ids for row in batch], dtype=np.int64
                    ),
                }
                (output,) = self.model.run(
                    [self.output], {key: arrays[key] for key in self.inputs}
                )
                vectors = output[:, 0, :] if output.ndim == 3 else output
                norms = np.linalg.norm(vectors, axis=1, keepdims=True)
                if (
                    vectors.shape[1] != 384
                    or not np.isfinite(vectors).all()
                    or (norms == 0).any()
                ):
                    raise ValueError("Invalid Granite embeddings")
                result.extend((vectors / norms).tolist())
        return result


@lru_cache(maxsize=1)
def _load(directory: Path, file_versions: tuple[int, ...]) -> Granite | None:
    try:
        return Granite(directory)
    except Exception as error:
        LOGGER.warning(
            "Granite unavailable (%s). Using character TF-IDF.", type(error).__name__
        )
        return None


def encoder(directory: Path | None) -> Granite | None:
    if directory is None:
        return None
    try:
        versions = tuple((directory / file).stat().st_mtime_ns for file in ARTIFACTS)
    except OSError:
        return None
    with MODEL_LOCK:
        return _load(directory, versions)


def embed(directory: Path | None, texts: list[str]) -> list[list[float]] | None:
    model = encoder(directory)
    if model is None:
        return None
    try:
        return model.encode(texts)
    except Exception as error:
        LOGGER.warning(
            "Granite encoding failed (%s). Using character TF-IDF.",
            type(error).__name__,
        )
        return None
