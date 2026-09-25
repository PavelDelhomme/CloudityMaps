FROM nginx:1.27-alpine
COPY web/nginx-default.conf /etc/nginx/conf.d/default.conf
COPY web/ /usr/share/nginx/html/
