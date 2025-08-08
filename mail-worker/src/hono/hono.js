import { Hono } from 'hono';
const app = new Hono();

import result from '../model/result';
import { cors } from 'hono/cors';

app.use('*', cors());

// ### [关键修改点] ###
// 我们将修改这个 onError 函数，让它返回更详细的错误信息
app.onError((err, c) => {
    // 在服务器的控制台（日志）中打印完整的错误信息，包括堆栈
    console.error('====== An error occurred! ======', err);
    
    // 准备返回给前端的错误信息
    const errorResponse = {
        code: err.code || 500, // 如果错误没有code，默认为500
        message: err.message || 'An internal server error occurred',
        // [最关键] 把错误的堆栈信息也加到返回的数据里
        stack: err.stack || 'No stack trace available' 
    };

    // 使用 result.fail 的结构，但把我们的详细错误作为 data 传回去
    // 注意：这里的 result.fail 可能是 result.error，根据您的 result.js 模型而定
    // 为了保险起见，我们直接构建JSON对象
    return c.json({
        code: errorResponse.code,
        message: errorResponse.message,
        data: {
            stack: errorResponse.stack
        }
    });
});

export default app;
