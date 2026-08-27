# AynReader OS avec Docker

Les Dockerfiles de ce repertoire servent a construire une image JVM ou native pour AynReader OS. Les artefacts de release doivent etre prepares par le pipeline de build avant l'execution de `docker build`.

## Donnees

Les donnees de l'instance sont stockees dans `/aynreader/data`. Monte un volume persistant pour conserver les comptes, les sources et les articles :

```bash
docker run --name aynreader \
  --detach \
  --publish 8082:8082 \
  --restart unless-stopped \
  --volume "$PWD/data:/aynreader/data" \
  --memory 256M \
  aynreader:latest
```

Pour une instance plus importante, configure une base PostgreSQL avec les variables Quarkus correspondantes :

```text
QUARKUS_DATASOURCE_JDBC_URL=jdbc:postgresql://postgresql:5432/aynreader
QUARKUS_DATASOURCE_USERNAME=aynreader
QUARKUS_DATASOURCE_PASSWORD=change-me
```

Les reglages de l'application sont documentes dans `aynreader-server/src/main/resources/application.properties`. Les variables d'environnement utilisent le prefixe `AYNREADER_`.
