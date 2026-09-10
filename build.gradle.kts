plugins {
    application
    java
    id("org.tavall.architecture-tests") version "0.1.0-SNAPSHOT"
}

group = "org.tavall.recovery"
version = "0.2.0-SNAPSHOT"

java {
    toolchain.languageVersion = JavaLanguageVersion.of(25)
}

repositories {
    mavenLocal()
    mavenCentral()
    val githubToken = providers.environmentVariable("GITHUB_TOKEN").orNull
    if (!githubToken.isNullOrBlank()) {
        listOf(
            "function-catalog",
            "tavall-di",
            "tavall-database",
            "tavall-logging",
        ).forEach { repository ->
            maven("https://maven.pkg.github.com/TavallStudios/$repository") {
                name = "github${repository.replace("-", "")}"
                credentials {
                    username = providers.environmentVariable("GITHUB_ACTOR").orElse("github").get()
                    password = githubToken
                }
            }
        }
    }
}

val functionCatalogVersion = providers.gradleProperty("functionCatalogVersion").orElse("1.0.1")
val tavallDiVersion = providers.gradleProperty("tavallDiVersion").orElse("1.0.0")

dependencies {
    implementation("org.tavall:ai-core:${functionCatalogVersion.get()}")
    implementation("org.tavall:agent-runtime:${functionCatalogVersion.get()}")
    implementation("org.tavall:strands-agent-provider:${functionCatalogVersion.get()}")
    implementation("org.tavall:mcp-server:${functionCatalogVersion.get()}")
    implementation("org.tavall:tavall-di:${tavallDiVersion.get()}")
    implementation("com.fasterxml.jackson.core:jackson-databind:2.20.1")
    implementation("com.fasterxml.jackson.datatype:jackson-datatype-jsr310:2.20.1")

    testImplementation(platform("org.junit:junit-bom:5.11.4"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testImplementation("org.assertj:assertj-core:3.27.7")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

architectureTests {
    modules.set(listOf("core", "patterns", "di", "runtime"))
}

application {
    mainClass = "org.tavall.recovery.RecoveryAgentApplication"
}

tasks.withType<JavaCompile>().configureEach {
    options.compilerArgs.add("-parameters")
}

tasks.test {
    useJUnitPlatform()
}
