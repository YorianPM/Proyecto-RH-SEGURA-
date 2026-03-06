const swaggerUi = require('swagger-ui-express');

const openapi = {
  openapi: '3.0.0',
  info: { title: 'RRHH API', version: '1.0.0' },
  servers: [{ url: 'http://localhost:4000' }],
  paths: {
    '/api/auth/login': {
      post: {
        summary: 'Login (Empleado)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object', properties: {
                usuario: { type:'string' },
                contrasena: { type:'string' }
              }, required:['usuario','contrasena'] }
            }
          }
        },
        responses: { '200': { description: 'OK' } }
      }
    }
  }
};

function mountSwagger(app) {
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapi));
}

module.exports = { mountSwagger };
