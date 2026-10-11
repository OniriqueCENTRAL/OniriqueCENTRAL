cmake_minimum_required(VERSION 3.22)

project(OniriqueProbe VERSION 1.0.0)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# JUCE 8, comme les plugins. Pour réutiliser une copie déjà sur le disque :
#   -DFETCHCONTENT_SOURCE_DIR_JUCE="C:/Users/mathe/Downloads/OniriqueBased/build/_deps/juce-src"
include(FetchContent)
FetchContent_Declare(
    JUCE
    GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
    GIT_TAG        8.0.4
    GIT_SHALLOW    TRUE)
FetchContent_MakeAvailable(JUCE)

juce_add_console_app(OniriqueProbe PRODUCT_NAME "onirique-probe")
target_sources(OniriqueProbe PRIVATE Probe.cpp)
target_compile_definitions(OniriqueProbe PRIVATE
    JUCE_PLUGINHOST_VST3=1
    JUCE_MODAL_LOOPS_PERMITTED=1
    JUCE_WEB_BROWSER=0
    JUCE_USE_CURL=0
    NOMINMAX)
target_link_libraries(OniriqueProbe PRIVATE
    juce::juce_audio_processors
    juce::juce_recommended_config_flags)

if(MSVC)
    target_compile_options(OniriqueProbe PRIVATE /utf-8)
endif()
