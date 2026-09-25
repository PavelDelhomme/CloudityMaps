FROM nginx:1.27-alpine
ARG MAPS_BUILD=0.1.17
LABEL hubera.maps.build=$MAPS_BUILD
COPY web/nginx-default.conf /etc/nginx/conf.d/default.conf
COPY web/ /usr/share/nginx/html/
