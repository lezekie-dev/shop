import packageJson from "../../package.json";

/**
 * Version de l'application exposée par la sonde de santé.
 *
 * Lue depuis `package.json` et non depuis une variable d'environnement : une
 * variable d'env se désynchronise du code déployé (on oublie de la mettre à
 * jour au déploiement), alors que ce champ est bumpé dans le même commit que
 * la livraison. La sonde sert justement à répondre à « quelle version tourne,
 * là, maintenant ? ».
 *
 * Ce n'est PAS une version d'infrastructure : ni version de Node, ni version
 * de PostgreSQL, ni nom d'image ou de serveur ne sortent de la sonde (une
 * version de plateforme est une information utile à qui cherche une faille).
 */
export const APP_VERSION: string = packageJson.version;
