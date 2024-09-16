const {createProxyMiddleware} = require('http-proxy-middleware');

module.exports = function (app) {
  app.use(
    '/lol',
    createProxyMiddleware({
      changeOrigin: true,
      timeout: 60000,
      proxyTimeout: 60000,
      logger: console,
      secure: false,
      pathRewrite: {
        '^/lol(?=/)': '',
      },
      on: {
        proxyReq: (proxyReq, req, res) => {
          // console.log("onProxyReq ")
          const port = req.headers['x-target-port'];
          if (port) {
            proxyReq.setHeader('Host', `127.0.0.1:${port}`);
            proxyReq.removeHeader('x-target-port');
            proxyReq.setHeader('target', `https://127.0.0.1:${port}`);
          }
        },
        proxyRes: (proxyRes, req, res) => {
          const exchange = `[${req.method}] [${proxyRes.statusCode}] ${req.path} -> ${proxyRes.req.protocol}//${proxyRes.req.host}${proxyRes.req.path}`;
          console.log(exchange); // [GET] [200] / -> http://www.example.com
        },
      },
      router: (req) => {
        // console.log("router ",req)
        const port = req.headers['x-target-port'];
        if (port) {
          return `https://127.0.0.1:${port}`;
        }
        return 'https://127.0.0.1';
      }
    })
  );
};
