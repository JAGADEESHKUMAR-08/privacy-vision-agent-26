"""
PII Type Classifier - Export Script.

Loads the trained numpy model weights and attempts to export to ONNX.
If onnx is unavailable, falls back to producing a pure-JS-compatible JSON
(pii_model.json) that the browser extension can load directly.

Run:
    python ml/export/export_pii_onnx.py
"""

import json
import os
import sys
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

EXTENSION_MODEL_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                                   "..", "extension", "model")

LABELS = [
    "EMAIL", "PHONE", "CREDIT_CARD", "NAME", "ADDRESS", "PASSWORD",
    "USERNAME", "API_KEY", "AUTH_TOKEN", "SSN", "MEDICAL_ID",
    "BANK_ACCOUNT", "FINANCIAL_DATA", "DATE_OF_BIRTH", "NONE",
]


def load_json(path):
    with open(path, "r") as f:
        return json.load(f)


def make_js_model(payload):
    """Create the full JS-compatible model JSON from the trained weights."""
    weights = payload["weights"]

    # Validate shapes
    config = payload["config"]
    vocab_size = config["vocab_size"]
    embed_dim = config["embed_dim"]
    hidden_dim = config["hidden_dim"]
    num_classes = config["num_classes"]

    emb = np.array(weights["embedding"], dtype=np.float32)
    W1 = np.array(weights["W1"], dtype=np.float32)
    b1 = np.array(weights["b1"], dtype=np.float32)
    W2 = np.array(weights["W2"], dtype=np.float32)
    b2 = np.array(weights["b2"], dtype=np.float32)

    assert emb.shape == (vocab_size, embed_dim), emb.shape
    assert W1.shape == (embed_dim, hidden_dim), W1.shape
    assert b1.shape == (hidden_dim,), b1.shape
    assert W2.shape == (hidden_dim, num_classes), W2.shape
    assert b2.shape == (num_classes,), b2.shape

    return payload


def export_onnx(payload, out_path):
    """Convert to ONNX using the onnx library if available."""
    try:
        import onnx
        from onnx import helper, TensorProto
    except ImportError:
        print("  onnx library not available - skipping ONNX export")
        return False

    config = payload["config"]
    vocab_size = config["vocab_size"]
    embed_dim = config["embed_dim"]
    hidden_dim = config["hidden_dim"]
    num_classes = config["num_classes"]
    max_len = config["max_len"]

    w = payload["weights"]
    emb = np.array(w["embedding"], dtype=np.float32)
    W1 = np.array(w["W1"], dtype=np.float32)
    b1 = np.array(w["b1"], dtype=np.float32)
    W2 = np.array(w["W2"], dtype=np.float32)
    b2 = np.array(w["b2"], dtype=np.float32)

    nodes = []
    initializers = []
    node_names = {}

    # Gather indices from embedding tables
    emb_init = helper.make_tensor("embedding", TensorProto.FLOAT,
                                  emb.shape, emb.flatten().tolist())
    initializers.append(emb_init)
    node_names["embedding"] = "embedding"

    W1_init = helper.make_tensor("W1", TensorProto.FLOAT, W1.shape, W1.flatten().tolist())
    b1_init = helper.make_tensor("b1", TensorProto.FLOAT, b1.shape, b1.flatten().tolist())
    initializers += [W1_init, b1_init]

    W2_init = helper.make_tensor("W2", TensorProto.FLOAT, W2.shape, W2.flatten().tolist())
    b2_init = helper.make_tensor("b2", TensorProto.FLOAT, b2.shape, b2.flatten().tolist())
    initializers += [W2_init, b2_init]

    # Gather: embedding[X] -> (batch, max_len, embed_dim)
    emb_idx = helper.make_node("Gather", ["embedding", "input_ids"], ["embedded"])
    nodes.append(emb_idx)

    # ReduceMean over sequence axis -> (batch, embed_dim)
    # (exclude padding by using identity trick is complex in pure onnx; we use
    # simple mean pooling as the trained model masks zeros though).
    # To keep equivalence with training, we multiply embedded by a mask.
    # Build a constant mask node computed from input_ids > 0.

    # Compute mask: Cast(Greater(input_ids, 0))
    greater = helper.make_node("Greater", ["input_ids", "zero_const"], ["pos_mask_bool"])
    nodes.append(greater)
    cast_mask = helper.make_node("Cast", ["pos_mask_bool"], ["pos_mask"],
                                 to=TensorProto.FLOAT)
    nodes.append(cast_mask)
    pos_initializer = helper.make_tensor("zero_const", TensorProto.INT64,
                                         [1], [0])
    initializers.append(pos_initializer)

    # expand mask from (batch,max_len) to (batch,max_len,embed_dim)
    shape = helper.make_node("Shape", ["pos_mask"], ["mask_shape"])
    nodes.append(shape)
    # easier: use Unsqueeze then tile is complex. Instead use Cast -> Reshape to 3D then Mul via broadcasting by Unsqueeze axis in onnx:
    unsqueeze = helper.make_node("Unsqueeze", ["pos_mask"], ["mask3d"],
                                 axes=[2])
    nodes.append(unsqueeze)

    masked = helper.make_node("Mul", ["embedded", "mask3d"], ["masked_emb"])
    nodes.append(masked)

    sum_emb = helper.make_node("ReduceSum", ["masked_emb"], ["sum_emb"],
                               axes=[1], keepdims=1)
    nodes.append(sum_emb)

    # count non-pad per row -> sum of mask over sequence
    count = helper.make_node("ReduceSum", ["pos_mask"], ["counts"],
                             axes=[1], keepdims=1)
    nodes.append(count)
    counts_shift = helper.make_node("Max", ["counts", "one_const"], ["counts_denom"])
    nodes.append(counts_shift)
    ones_initializer = helper.make_tensor("one_const", TensorProto.FLOAT, [1], [1.0])
    initializers.append(ones_initializer)

    # Expand counts_denom from (batch,1) to (batch,1,embed_dim) via Reshape+Expand
    # Simpler: divide sum_emb by counts broadcast (batch,1,1) won't broadcast directly;
    # use Expand.
    counts_3d = helper.make_node("Unsqueeze", ["counts_denom"], ["counts_2d"],
                                 axes=[2])
    nodes.append(counts_3d)
    pooled = helper.make_node("Div", ["sum_emb", "counts_2d"], ["pooled"])
    nodes.append(pooled)

    # Linear 1
    gemm1 = helper.make_node("Gemm", ["pooled", "W1", "b1"], ["z1"],
                             alpha=1.0, beta=1.0, transA=0, transB=0)
    nodes.append(gemm1)
    relu1 = helper.make_node("Relu", ["z1"], ["a1"])
    nodes.append(relu1)

    # Linear 2
    gemm2 = helper.make_node("Gemm", ["a1", "W2", "b2"], ["z2"],
                             alpha=1.0, beta=1.0, transA=0, transB=0)
    nodes.append(gemm2)
    softmax_node = helper.make_node("Softmax", ["z2"], ["probs"], axis=1)
    nodes.append(softmax_node)

    graph = helper.make_graph(
        nodes,
        "pii_classifier",
        [helper.make_tensor_value_info("input_ids", TensorProto.INT64, [None, max_len])],
        [helper.make_tensor_value_info("probs", TensorProto.FLOAT, [None, num_classes])],
        initializer=initializers,
    )
    model = helper.make_model(graph, producer_name="privacy-vision-agent",
                              opset_imports=[helper.make_opsetid("", 13)])
    model.ir_version = 8
    onnx.checker.check_model(model)
    onnx.save(model, out_path)
    print(f"  ONNX model saved to {out_path}")
    return True


def main():
    print("=" * 64)
    print("PII Type Classifier - Export")
    print("=" * 64)

    weights_path = os.path.join(EXTENSION_MODEL_DIR, "pii_weights.json")
    if not os.path.exists(weights_path):
        print(f"ERROR: {weights_path} not found. Run training first:")
        print("  python ml/training/train_pii.py")
        sys.exit(1)

    payload = load_json(weights_path)
    print(f"Loaded weights from {weights_path}")

    # 1. Build / refresh JS-compatible model
    print("\n[1/3] Building JS-compatible model (pii_model.json)...")
    js_model = make_js_model(payload)
    model_path = os.path.join(EXTENSION_MODEL_DIR, "pii_model.json")
    with open(model_path, "w") as f:
        json.dump(js_model, f)
    print(f"  Saved to {model_path}")

    # 2. Attempt ONNX export
    print("\n[2/3] Attempting ONNX export...")
    onnx_path = os.path.join(EXTENSION_MODEL_DIR, "pii_model.onnx")
    exported = export_onnx(payload, onnx_path)
    if not exported:
        print("  ONNX skipped (library unavailable). Using JS JSON format only.")

    # 3. Summary
    print("\n[3/3] Summary")
    print("=" * 64)
    print("  pii_model.json  - full model for direct JS inference")
    print("  pii_weights.json- raw weights (training format)")
    if exported:
        print("  pii_model.onnx  - ONNX format for other inference runtimes")
    print("\nTo use in the browser extension, import pii_model.json.")
    print("Done.")


if __name__ == "__main__":
    main()
