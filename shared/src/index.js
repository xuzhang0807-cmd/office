/**
 * 共享层统一出口。
 * 这里只放「无状态纯函数 + 无业务语义的协议胶水」：
 * 谁都不许在这里 import 业务模块，否则模块边界就破了。
 */
export * as util from './util.js';
export * as html from './html.js';
export * as http from './http.js';
export * as service from './service.js';
