// redirects page if not in iframe

if (top === self) window.location.href = window.location.origin + '/?T=tour&U=' + parseInt(window.location.href.match(/tour(\d+)/)[1]);
