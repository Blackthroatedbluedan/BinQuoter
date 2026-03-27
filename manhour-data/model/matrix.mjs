/** Tiny dense matrix helpers (no dependencies). */

export function zeros(rows, cols) {
  return Array.from({ length: rows }, () => Array(cols).fill(0));
}

export function transpose(A) {
  const m = A.length;
  const n = A[0].length;
  const T = zeros(n, m);
  for (let i = 0; i < m; i++) for (let j = 0; j < n; j++) T[j][i] = A[i][j];
  return T;
}

export function mul(A, B) {
  const m = A.length;
  const k = A[0].length;
  const n = B[0].length;
  const C = zeros(m, n);
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      let s = 0;
      for (let t = 0; t < k; t++) s += A[i][t] * B[t][j];
      C[i][j] = s;
    }
  }
  return C;
}

export function identity(n) {
  const I = zeros(n, n);
  for (let i = 0; i < n; i++) I[i][i] = 1;
  return I;
}

/** Invert square matrix via Gauss-Jordan elimination */
export function invert(M) {
  const n = M.length;
  const A = M.map((row) => [...row]);
  const I = identity(n);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(A[r][col]) > Math.abs(A[pivot][col])) pivot = r;
    }
    if (Math.abs(A[pivot][col]) < 1e-12) throw new Error("Matrix singular or near-singular");
    if (pivot !== col) {
      [A[col], A[pivot]] = [A[pivot], A[col]];
      [I[col], I[pivot]] = [I[pivot], I[col]];
    }
    const div = A[col][col];
    for (let j = 0; j < n; j++) {
      A[col][j] /= div;
      I[col][j] /= div;
    }
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = A[r][col];
      if (Math.abs(f) < 1e-15) continue;
      for (let j = 0; j < n; j++) {
        A[r][j] -= f * A[col][j];
        I[r][j] -= f * I[col][j];
      }
    }
  }
  return I;
}

/** Ridge: beta = (X'X + λI)^{-1} X'y */
export function ridgeSolve(X, y, lambda) {
  const m = X.length;
  const p = X[0].length;
  const Xt = transpose(X);
  const XtX = mul(Xt, X);
  for (let i = 0; i < p; i++) XtX[i][i] += lambda;
  const Xty = zeros(p, 1);
  for (let i = 0; i < p; i++) {
    let s = 0;
    for (let r = 0; r < m; r++) s += X[r][i] * y[r];
    Xty[i][0] = s;
  }
  const inv = invert(XtX);
  const beta = mul(inv, Xty);
  return beta.map((row) => row[0]);
}

export function rmse(yTrue, yPred) {
  let s = 0;
  for (let i = 0; i < yTrue.length; i++) {
    const d = yTrue[i] - yPred[i];
    s += d * d;
  }
  return Math.sqrt(s / yTrue.length);
}
