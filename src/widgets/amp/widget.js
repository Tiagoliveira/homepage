import ampProxyHandler from "./proxy";

const widget = {
  proxyHandler: ampProxyHandler,
  allowedEndpoints: /stats/,
};

export default widget;
