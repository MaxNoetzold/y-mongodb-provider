import typescript from "@rollup/plugin-typescript";

export default {
  input: "src/server.mts",
  output: {
    dir: "dist",
    format: "cjs",
    sourcemap: true,
    paths: (path) => {
      if (/^lib0\//.test(path)) {
        // return `lib0/dist/${path.slice(5, -3)}.cjs
        return `lib0/dist/${path.slice(5)}.cjs`;
      } else if (/^y-protocols\//.test(path)) {
        return `y-protocols/dist${path.slice(11)}.cjs`;
      }
      return path;
    },
  },
  external: (id) =>
    /^(lib0|yjs|y-protocols|dotenv\/config|http|ws|y-mongodb-provider)/.test(
      id
    ),
  plugins: [typescript()],
};
