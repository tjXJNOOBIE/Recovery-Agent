plugins {
    application
    java
}

group = "org.tavall.recovery"
version = "0.1.0"

java {
    toolchain.languageVersion = JavaLanguageVersion.of(25)
}

repositories {
    mavenCentral()
    val githubToken = providers.environmentVariable("GITHUB_TOKEN").orNull
    if (!githubToken.isNullOrBlank()) {
        listOf("tavall-database", "tavall-logging").forEach { repository ->
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

dependencies {
    implementation("org.tavall:tavall-database-postgres:1.0.0")
    implementation("com.fasterxml.jackson.core:jackson-databind:2.18.3")
    runtimeOnly("org.hibernate.orm:hibernate-core:6.6.15.Final")

    testImplementation(platform("org.junit:junit-bom:5.11.4"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testRuntimeOnly("com.h2database:h2:2.4.240")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher:1.11.4")
}

application {
    mainClass.set("org.tavall.recovery.state.RecoveryStateAuthorityMain")
}

tasks.named<Sync>("installDist") {
    into(project.layout.projectDirectory.dir("../state-authority-runtime"))
}

tasks.named<Delete>("clean") {
    delete(project.layout.projectDirectory.dir("../state-authority-runtime"))
}

tasks.withType<Test>().configureEach {
    useJUnitPlatform()
}
